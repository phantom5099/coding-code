export function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[at + i] ?? 0);
  return out;
}

/** 魔数嗅探 mime；识别不了的返回 null，调用方决定降级策略。 */
export function sniffMediaMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
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

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';

  // GIF: GIF87a / GIF89a
  if (ascii(bytes, 0, 4) === 'GIF8') return 'image/gif';

  // RIFF 容器：偏移 8 处区分 WebP / WAV
  if (ascii(bytes, 0, 4) === 'RIFF') {
    const form = ascii(bytes, 8, 4);
    if (form === 'WEBP') return 'image/webp';
    if (form === 'WAVE') return 'audio/wav';
    return null;
  }

  // PDF: %PDF-
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';

  // MP3: ID3v2 标签 或 帧同步字（11 个 1）
  if (ascii(bytes, 0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg';

  return null;
}
