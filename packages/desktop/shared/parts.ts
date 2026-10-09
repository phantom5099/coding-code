import type { InputPart } from '@codingcode/sdk';

/** 媒体按 mime 主类型分档：与 `packages/codingcode/src/llm/types.ts` 同一口径。 */
export type MediaKind = 'image' | 'audio' | 'file';

export function mediaKindOf(mimeType: string): MediaKind {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/** 服务端回吐的落盘形态：只有资产名与元数据。 */
export interface StoredMediaPart {
  type: 'media';
  asset: string;
  mimeType: string;
  bytes: number;
  filename?: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

/** 本地乐观条目：还没拿到服务端资产名，先带 data URL。 */
export interface LocalMediaPart {
  type: 'media';
  dataUrl: string;
  mimeType: string;
  filename?: string;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | StoredMediaPart
  | LocalMediaPart;

export function isStoredMedia(p: ContentPart): p is StoredMediaPart {
  return p.type === 'media' && 'asset' in p;
}

export function isLocalMedia(p: ContentPart): p is LocalMediaPart {
  return p.type === 'media' && 'dataUrl' in p;
}

/** 纯文本块：程序化发起的一轮输入（如 plan 决策）用得上。 */
export function textPart(text: string): ContentPart {
  return { type: 'text', text };
}

const MEDIA_MARKER: Record<MediaKind, string> = {
  image: '[image]',
  audio: '[audio]',
  file: '[file]',
};

/** 文本投影：标题、回滚回填、assistant 合并共用的口径。 */
export function textOf(parts: readonly ContentPart[]): string {
  return parts
    .map((p) => (p.type === 'text' ? p.text : MEDIA_MARKER[mediaKindOf(p.mimeType)]))
    .join('\n');
}

/** 待发送的 parts → 线上部件。落盘形态（asset）无法再次上传，直接跳过。 */
export function toWireParts(parts: readonly ContentPart[]): InputPart[] {
  const wire: InputPart[] = [];
  for (const p of parts) {
    if (p.type === 'text') {
      wire.push({ type: 'text', text: p.text });
      continue;
    }
    if (isLocalMedia(p)) {
      wire.push({
        type: 'media',
        dataUrl: p.dataUrl,
        ...(p.filename ? { filename: p.filename } : {}),
      });
    }
  }
  return wire;
}

/** 资产地址：媒体不经过 SSE，直接指向服务端的资产路由。 */
export function assetUrl(asset: string, cwd: string, apiBase: string): string {
  return `${apiBase}/api/assets/${asset}?cwd=${encodeURIComponent(cwd)}`;
}

/** 渲染用的媒体地址：落盘条目走后端路由，本地条目直接用 data URL。 */
export function srcOf(p: ContentPart, cwd: string, apiBase: string): string {
  return isStoredMedia(p) ? assetUrl(p.asset, cwd, apiBase) : (p as LocalMediaPart).dataUrl;
}

/** 前端白名单提示，与服务端 `sniffMediaMime` 同表。最终准入以服务端嗅探结果为准。 */
export const ACCEPTED_MIME: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'audio/wav',
  'audio/mpeg',
  'application/pdf',
];

/** 当前模型可达的格式：vision 覆盖图片与 PDF，audio 覆盖音频输入。 */
export function reachableMimes(caps?: { vision: boolean; audio: boolean }): string[] {
  if (!caps) return [...ACCEPTED_MIME];
  return ACCEPTED_MIME.filter((m) =>
    mediaKindOf(m) === 'audio' ? caps.audio : caps.vision
  );
}

/** 模型拒绝某类附件时的提示文案；都能收时为 null。 */
export function attachmentHint(caps?: { vision: boolean; audio: boolean }): string | null {
  if (!caps) return null;
  if (!caps.vision && !caps.audio) return '当前模型不支持图片、PDF 与音频输入';
  if (!caps.vision) return '当前模型不支持图片与 PDF 输入';
  if (!caps.audio) return '当前模型不支持音频输入';
  return null;
}
