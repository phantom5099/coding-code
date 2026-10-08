import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ascii } from '../util/media.js';

/** 单份媒体的字节上限。 */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
/** 单回合的媒体份数上限。 */
export const MAX_MEDIA_PER_TURN = 8;
/** 单条输入文本的字符上限。 */
export const MAX_TEXT_CHARS = 1 << 20;

/** mime → 扩展名。白名单即此表，顺序无关。 */
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
};

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  pdf: 'application/pdf',
};

function u16le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function u32be(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) << 24) |
    ((bytes[at + 1] ?? 0) << 16) |
    ((bytes[at + 2] ?? 0) << 8) |
    (bytes[at + 3] ?? 0)
  ) >>> 0;
}

function u32le(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) |
      ((bytes[at + 1] ?? 0) << 8) |
      ((bytes[at + 2] ?? 0) << 16) |
      ((bytes[at + 3] ?? 0) << 24)) >>>
    0
  );
}

/** 图片宽高，从文件头解析，不解码像素。 */
export function readImageSize(
  bytes: Uint8Array,
  mimeType: string
): { width: number; height: number } | null {
  try {
    switch (mimeType) {
      case 'image/png': {
        // IHDR 紧随 8 字节签名 + 4 字节长度 + 4 字节类型
        if (bytes.length < 24) return null;
        if (ascii(bytes, 12, 4) !== 'IHDR') return null;
        return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
      }
      case 'image/gif': {
        // 逻辑屏幕描述符：offset 6 / 8
        if (bytes.length < 10) return null;
        return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
      }
      case 'image/jpeg': {
        let at = 2;
        while (at + 9 < bytes.length) {
          if (bytes[at] !== 0xff) {
            at++;
            continue;
          }
          const marker = bytes[at + 1] ?? 0;
          // 填充字节
          if (marker === 0xff) {
            at++;
            continue;
          }
          // 无载荷的标记
          if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            at += 2;
            continue;
          }
          const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
          // SOF0..SOF15，排除 DHT(C4) / JPG(C8) / DAC(CC)
          const isSof =
            marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
          if (isSof) {
            return {
              height: ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0),
              width: ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0),
            };
          }
          // SOS 之后是熵编码数据，不再有尺寸信息
          if (marker === 0xda) return null;
          if (length < 2) return null;
          at += 2 + length;
        }
        return null;
      }
      case 'image/webp': {
        if (bytes.length < 30) return null;
        const chunk = ascii(bytes, 12, 4);
        if (chunk === 'VP8 ') {
          // 有损：帧标签 3 字节 + 同步码 3 字节，随后 14 位宽 / 14 位高
          if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
          return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
        }
        if (chunk === 'VP8L') {
          if (bytes[20] !== 0x2f) return null;
          const bits = u32le(bytes, 21);
          return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        if (chunk === 'VP8X') {
          const width = ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16)) + 1;
          const height = ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16)) + 1;
          return { width, height };
        }
        return null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** MPEG 音频比特率表（kbps）；索引即帧头的 bitrate_index。 */
const BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
BITRATES['2-3'] = BITRATES['2-2']!;

function id3v2Size(bytes: Uint8Array): number {
  if (ascii(bytes, 0, 3) !== 'ID3' || bytes.length < 10) return 0;
  const size =
    (((bytes[6] ?? 0) & 0x7f) << 21) |
    (((bytes[7] ?? 0) & 0x7f) << 14) |
    (((bytes[8] ?? 0) & 0x7f) << 7) |
    ((bytes[9] ?? 0) & 0x7f);
  const footer = ((bytes[5] ?? 0) & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

function readMp3BitrateKbps(bytes: Uint8Array, start: number): number | null {
  for (let at = start; at + 4 <= bytes.length; at++) {
    if (bytes[at] !== 0xff || ((bytes[at + 1] ?? 0) & 0xe0) !== 0xe0) continue;
    const versionBits = ((bytes[at + 1] ?? 0) >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layerBits = ((bytes[at + 1] ?? 0) >> 1) & 0x03; // 3=Layer1, 2=Layer2, 1=Layer3
    const bitrateIndex = ((bytes[at + 2] ?? 0) >> 4) & 0x0f;
    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15) continue;
    const version = versionBits === 3 ? '1' : '2';
    const layer = layerBits === 3 ? '1' : layerBits === 2 ? '2' : '3';
    const table = BITRATES[`${version}-${layer}`];
    const kbps = table?.[bitrateIndex];
    if (kbps) return kbps;
  }
  return null;
}

/**
 * 音频时长（秒），从容器头解析，不做解码。
 *
 * MP3 按首帧比特率折算（VBR 文件会偏大），只用于 token 估算，不参与出网。
 */
export function readAudioDurationSec(bytes: Uint8Array, mimeType: string): number | null {
  try {
    if (mimeType === 'audio/wav') return readWavDurationSec(bytes);
    if (mimeType === 'audio/mpeg') return readMp3DurationSec(bytes);
    return null;
  } catch {
    return null;
  }
}

function readWavDurationSec(bytes: Uint8Array): number | null {
  if (bytes.length < 12 || ascii(bytes, 8, 4) !== 'WAVE') return null;
  let at = 12;
  let byteRate = 0;
  let dataSize = -1;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at, 4);
    const size = u32le(bytes, at + 4);
    const body = at + 8;
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      byteRate = u32le(bytes, body + 8);
    } else if (id === 'data') {
      dataSize = size;
      // 两个块的顺序不固定：两个都拿到就可以算
      if (byteRate > 0) break;
    }
    at = body + size + (size % 2);
  }
  if (byteRate <= 0 || dataSize < 0) return null;
  return dataSize / byteRate;
}

function readMp3DurationSec(bytes: Uint8Array): number | null {
  const id3 = id3v2Size(bytes);
  const kbps = readMp3BitrateKbps(bytes, id3);
  if (!kbps) return null;
  const audioBytes = bytes.length - id3;
  if (audioBytes <= 0) return null;
  return (audioBytes * 8) / (kbps * 1000);
}

/** 内容寻址：sha256(bytes).slice(0, 32) + 扩展名。 */
export function assetNameFor(bytes: Uint8Array, mimeType: string): string {
  const ext = EXT_BY_MIME[mimeType];
  if (!ext) throw new Error(`Unsupported media type: ${mimeType}`);
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return `${digest}.${ext}`;
}

/** 资产名 → mime。扩展名由嗅探结果生成，反向查表即权威。 */
export function mimeTypeFromAssetName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** 目标已存在则直接返回；否则原子就位。 */
export function writeAsset(dir: string, name: string, bytes: Uint8Array): void {
  const target = join(dir, name);
  if (existsSync(target)) return;
  mkdirSync(dir, { recursive: true });
  // 同目录重命名是原子的：项目级共享下同一张图可能被多个会话并发写入
  const tmp = join(dir, `${name}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* 清理失败不掩盖原错误 */
    }
    throw e;
  }
}

export function readAsset(dir: string, name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(dir, name)));
}
