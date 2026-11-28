/** 单份媒体的字节上限；服务端落盘与前端早退共用同一常量 */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

/** 支持的媒体 MIME 白名单；与魔数嗅探保持同源 */
export const ACCEPTED_MEDIA_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'audio/wav',
  'audio/mpeg',
  'application/pdf',
] as const;

export type AcceptedMediaMime = (typeof ACCEPTED_MEDIA_MIMES)[number];

/** 媒体按 mime 主类型分档：全链路唯一判定口径 */
export type MediaKind = 'image' | 'audio' | 'file';

export function mediaKindOf(mimeType: string): MediaKind {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

export interface TextPart {
  type: 'text';
  text: string;
}

export const textPart = (text: string): TextPart => ({ type: 'text', text });

const MEDIA_MARKER: Record<MediaKind, string> = {
  image: '[image]',
  audio: '[audio]',
  file: '[file]',
};

type ProjectablePart =
  | TextPart
  | { type: 'media'; mimeType?: string; declaredMimeType?: string };

/** 文本投影：标题 / 压缩模板 / 记忆摘要 / UI 回填共用的唯一口径 */
export function textOf(parts: readonly ProjectablePart[]): string {
  return parts
    .map((p) => {
      if (p.type === 'text') return p.text;
      const mime = p.mimeType ?? p.declaredMimeType ?? '';
      return MEDIA_MARKER[mediaKindOf(mime)];
    })
    .join('\n');
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[at + i] ?? 0);
  return out;
}

/** 魔数嗅探 mime；识别不了的返回 null，调用方决定降级策略 */
export function sniffMediaMime(bytes: Uint8Array): AcceptedMediaMime | null {
  if (bytes.length < 12) return null;

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';

  if (ascii(bytes, 0, 4) === 'GIF8') return 'image/gif';

  if (ascii(bytes, 0, 4) === 'RIFF') {
    const form = ascii(bytes, 8, 4);
    if (form === 'WEBP') return 'image/webp';
    if (form === 'WAVE') return 'audio/wav';
    return null;
  }

  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';

  if (ascii(bytes, 0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg';

  return null;
}
