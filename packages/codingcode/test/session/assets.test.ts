import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  assetNameFor,
  mimeTypeFromAssetName,
  readAudioDurationSec,
  readImageSize,
  writeAsset,
} from '../../src/session/assets.js';
import { sniffMediaMime } from '../../src/util/media.js';

function ascii(b: Uint8Array, at: number, s: string): void {
  for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i);
}

function u16le(b: Uint8Array, at: number, v: number): void {
  b[at] = v & 0xff;
  b[at + 1] = (v >> 8) & 0xff;
}

function u16be(b: Uint8Array, at: number, v: number): void {
  b[at] = (v >> 8) & 0xff;
  b[at + 1] = v & 0xff;
}

function u32le(b: Uint8Array, at: number, v: number): void {
  b[at] = v & 0xff;
  b[at + 1] = (v >> 8) & 0xff;
  b[at + 2] = (v >> 16) & 0xff;
  b[at + 3] = (v >>> 24) & 0xff;
}

function u32be(b: Uint8Array, at: number, v: number): void {
  b[at] = (v >>> 24) & 0xff;
  b[at + 1] = (v >> 16) & 0xff;
  b[at + 2] = (v >> 8) & 0xff;
  b[at + 3] = v & 0xff;
}

/** 只搭出嗅探与尺寸解析需要的那几个字节，不做真解码。 */
function pngBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  u32be(b, 8, 13);
  ascii(b, 12, 'IHDR');
  u32be(b, 16, width);
  u32be(b, 20, height);
  return b;
}

function jpegBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(64);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  // APP0 段：长度 16 ⇒ 下一个标记落在偏移 20
  b[3] = 0xe0;
  u16be(b, 4, 16);
  b[20] = 0xff;
  b[21] = 0xc0; // SOF0
  u16be(b, 22, 17);
  b[24] = 0x08;
  u16be(b, 25, height);
  u16be(b, 27, width);
  return b;
}

function gifBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(16);
  ascii(b, 0, 'GIF89a');
  u16le(b, 6, width);
  u16le(b, 8, height);
  return b;
}

function webpLossyBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(32);
  ascii(b, 0, 'RIFF');
  u32le(b, 4, b.length - 8);
  ascii(b, 8, 'WEBP');
  ascii(b, 12, 'VP8 ');
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  u16le(b, 26, width);
  u16le(b, 28, height);
  return b;
}

function webpLosslessBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(32);
  ascii(b, 0, 'RIFF');
  u32le(b, 4, b.length - 8);
  ascii(b, 8, 'WEBP');
  ascii(b, 12, 'VP8L');
  b[20] = 0x2f;
  u32le(b, 21, (width - 1) | ((height - 1) << 14));
  return b;
}

function webpExtendedBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  ascii(b, 0, 'RIFF');
  u32le(b, 4, b.length - 8);
  ascii(b, 8, 'WEBP');
  ascii(b, 12, 'VP8X');
  const w = width - 1;
  const h = height - 1;
  b[24] = w & 0xff;
  b[25] = (w >> 8) & 0xff;
  b[26] = (w >> 16) & 0xff;
  b[27] = h & 0xff;
  b[28] = (h >> 8) & 0xff;
  b[29] = (h >> 16) & 0xff;
  return b;
}

function wavBytes(durationSec: number, byteRate: number): Uint8Array {
  const dataSize = Math.round(durationSec * byteRate);
  const b = new Uint8Array(44);
  ascii(b, 0, 'RIFF');
  u32le(b, 4, 36);
  ascii(b, 8, 'WAVE');
  ascii(b, 12, 'fmt ');
  u32le(b, 16, 16);
  u16le(b, 20, 1);
  u16le(b, 22, 1);
  u32le(b, 24, byteRate);
  u32le(b, 28, byteRate);
  u16le(b, 32, 1);
  u16le(b, 34, 8);
  ascii(b, 36, 'data');
  u32le(b, 40, dataSize);
  return b;
}

/** MPEG1 Layer3、比特率索引 9（128kbps）的首帧头。 */
function mp3Bytes(totalBytes: number, id3TagBytes = 0): Uint8Array {
  const b = new Uint8Array(totalBytes);
  if (id3TagBytes > 0) {
    ascii(b, 0, 'ID3');
    b[3] = 3;
    b[5] = 0;
    const size = id3TagBytes - 10;
    b[6] = (size >> 21) & 0x7f;
    b[7] = (size >> 14) & 0x7f;
    b[8] = (size >> 7) & 0x7f;
    b[9] = size & 0x7f;
  }
  b[id3TagBytes] = 0xff;
  b[id3TagBytes + 1] = 0xfb;
  b[id3TagBytes + 2] = 0x90;
  return b;
}

function pdfBytes(): Uint8Array {
  const b = new Uint8Array(16);
  ascii(b, 0, '%PDF-1.7');
  return b;
}

describe('sniffMediaMime', () => {
  it('识别白名单里的七种格式', () => {
    expect(sniffMediaMime(pngBytes(4, 4))).toBe('image/png');
    expect(sniffMediaMime(jpegBytes(4, 4))).toBe('image/jpeg');
    expect(sniffMediaMime(gifBytes(4, 4))).toBe('image/gif');
    expect(sniffMediaMime(webpLossyBytes(4, 4))).toBe('image/webp');
    expect(sniffMediaMime(webpLosslessBytes(4, 4))).toBe('image/webp');
    expect(sniffMediaMime(wavBytes(1, 8000))).toBe('audio/wav');
    expect(sniffMediaMime(mp3Bytes(1024))).toBe('audio/mpeg');
    expect(sniffMediaMime(pdfBytes())).toBe('application/pdf');
  });

  it('RIFF 容器按偏移 8 的 form 区分 WebP 与 WAV', () => {
    const avi = new Uint8Array(16);
    ascii(avi, 0, 'RIFF');
    ascii(avi, 8, 'AVI ');
    expect(sniffMediaMime(avi)).toBeNull();
  });

  it('伪造扩展名的非媒体文件一律返回 null', () => {
    const text = new Uint8Array(64);
    ascii(text, 0, 'this is not media at all');
    expect(sniffMediaMime(text)).toBeNull();
    expect(sniffMediaMime(new Uint8Array(4))).toBeNull();
  });
});

describe('readImageSize', () => {
  it('PNG 从 IHDR 读宽高', () => {
    expect(readImageSize(pngBytes(640, 480), 'image/png')).toEqual({ width: 640, height: 480 });
  });

  it('JPEG 扫到 SOF0 才读宽高', () => {
    expect(readImageSize(jpegBytes(320, 200), 'image/jpeg')).toEqual({ width: 320, height: 200 });
  });

  it('GIF 从逻辑屏幕描述符读宽高', () => {
    expect(readImageSize(gifBytes(120, 90), 'image/gif')).toEqual({ width: 120, height: 90 });
  });

  it('WebP 三种变体都能读宽高', () => {
    expect(readImageSize(webpLossyBytes(800, 600), 'image/webp')).toEqual({
      width: 800,
      height: 600,
    });
    expect(readImageSize(webpLosslessBytes(333, 222), 'image/webp')).toEqual({
      width: 333,
      height: 222,
    });
    expect(readImageSize(webpExtendedBytes(4096, 2048), 'image/webp')).toEqual({
      width: 4096,
      height: 2048,
    });
  });

  it('头不完整时返回 null 而不是抛错', () => {
    expect(readImageSize(new Uint8Array(4), 'image/png')).toBeNull();
    expect(readImageSize(new Uint8Array(4), 'image/jpeg')).toBeNull();
    expect(readImageSize(new Uint8Array(4), 'image/webp')).toBeNull();
  });
});

describe('readAudioDurationSec', () => {
  it('WAV 按 data 块体积与 byteRate 折算', () => {
    expect(readAudioDurationSec(wavBytes(2, 8000), 'audio/wav')).toBe(2);
    expect(readAudioDurationSec(wavBytes(3, 44100), 'audio/wav')).toBe(3);
  });

  it('MP3 按首帧比特率折算，并跳过 ID3v2 标签', () => {
    // 32000 字节 / 128kbps = 2 秒
    expect(readAudioDurationSec(mp3Bytes(32000), 'audio/mpeg')).toBe(2);
    // ID3 标签不计入音频体积：多出来的 1000 字节不改变时长
    expect(readAudioDurationSec(mp3Bytes(33000, 1000), 'audio/mpeg')).toBe(2);
  });

  it('非音频 mime 返回 null', () => {
    expect(readAudioDurationSec(pngBytes(4, 4), 'image/png')).toBeNull();
  });
});

describe('assetNameFor / mimeTypeFromAssetName', () => {
  it('同字节同名、异字节异名，且扩展名跟随嗅探结果', () => {
    const a = pngBytes(4, 4);
    const b = pngBytes(8, 8);
    expect(assetNameFor(a, 'image/png')).toBe(assetNameFor(a, 'image/png'));
    expect(assetNameFor(a, 'image/png')).not.toBe(assetNameFor(b, 'image/png'));
    expect(assetNameFor(a, 'image/png')).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(assetNameFor(mp3Bytes(64), 'audio/mpeg')).toMatch(/^[0-9a-f]{32}\.mp3$/);
  });

  it('扩展名与白名单反向一致，未知扩展名退回 octet-stream', () => {
    expect(mimeTypeFromAssetName('a'.repeat(32) + '.png')).toBe('image/png');
    expect(mimeTypeFromAssetName('a'.repeat(32) + '.jpg')).toBe('image/jpeg');
    expect(mimeTypeFromAssetName('a'.repeat(32) + '.gif')).toBe('image/gif');
    expect(mimeTypeFromAssetName('a'.repeat(32) + '.webp')).toBe('image/webp');
    expect(mimeTypeFromAssetName('a'.repeat(32) + '.wav')).toBe('audio/wav');
    expect(mimeTypeFromAssetName('a'.repeat(32) + '.mp3')).toBe('audio/mpeg');
    expect(mimeTypeFromAssetName('a'.repeat(32) + '.pdf')).toBe('application/pdf');
    expect(mimeTypeFromAssetName('a'.repeat(32) + '.exe')).toBe('application/octet-stream');
  });
});

describe('writeAsset', () => {
  it('内容寻址 ⇒ 写两次目录里仍只有一份，且不留 .tmp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codingcode-assets-'));
    try {
      const bytes = pngBytes(16, 16);
      const name = assetNameFor(bytes, 'image/png');
      writeAsset(dir, name, bytes);
      writeAsset(dir, name, bytes);

      const entries = readdirSync(dir);
      expect(entries).toEqual([name]);
      expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('目录不存在时自建（项目级 assets 与 sessions 并列，可能还没被创建）', () => {
    const root = mkdtempSync(join(tmpdir(), 'codingcode-assets-'));
    const dir = join(root, 'assets');
    try {
      const bytes = pdfBytes();
      const name = assetNameFor(bytes, 'application/pdf');
      writeAsset(dir, name, bytes);
      expect(readdirSync(dir)).toEqual([name]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
