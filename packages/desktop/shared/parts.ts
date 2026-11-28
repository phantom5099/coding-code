import {
  ACCEPTED_MEDIA_MIMES,
  mediaKindOf,
  textOf,
  textPart,
  type InputPart,
  type MediaKind,
  type StoredMediaPart,
  type TextPart,
} from '@codingcode/sdk';

export { mediaKindOf, textOf, textPart, type MediaKind, type StoredMediaPart };

/** 前端白名单提示，与服务端 `sniffMediaMime` 同源 */
export const ACCEPTED_MIME: readonly string[] = ACCEPTED_MEDIA_MIMES;

/** 本地乐观条目：还没拿到服务端资产名，先带 data URL */
export interface LocalMediaPart {
  type: 'media';
  dataUrl: string;
  mimeType: string;
  filename?: string;
}

export type ContentPart = TextPart | StoredMediaPart | LocalMediaPart;

export function isStoredMedia(p: ContentPart): p is StoredMediaPart {
  return p.type === 'media' && 'asset' in p;
}

export function isLocalMedia(p: ContentPart): p is LocalMediaPart {
  return p.type === 'media' && 'dataUrl' in p;
}

/** 待发送的 parts → 线上部件。落盘形态（asset）无法再次上传，直接跳过 */
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

/** 资产地址：媒体不经过 SSE，直接指向服务端的资产路由 */
export function assetUrl(asset: string, cwd: string, apiBase: string): string {
  return `${apiBase}/api/assets/${asset}?cwd=${encodeURIComponent(cwd)}`;
}

/** 渲染用的媒体地址：落盘条目走后端路由，本地条目直接用 data URL */
export function srcOf(p: ContentPart, cwd: string, apiBase: string): string {
  return isStoredMedia(p) ? assetUrl(p.asset, cwd, apiBase) : (p as LocalMediaPart).dataUrl;
}

/** 当前模型可达的格式：vision 覆盖图片与 PDF，audio 覆盖音频输入 */
export function reachableMimes(caps?: { vision: boolean; audio: boolean }): string[] {
  if (!caps) return [...ACCEPTED_MIME];
  return ACCEPTED_MIME.filter((m) =>
    mediaKindOf(m) === 'audio' ? caps.audio : caps.vision
  );
}

/** 模型拒绝某类附件时的提示文案；都能收时为 null */
export function attachmentHint(caps?: { vision: boolean; audio: boolean }): string | null {
  if (!caps) return null;
  if (!caps.vision && !caps.audio) return '当前模型不支持图片、PDF 与音频输入';
  if (!caps.vision) return '当前模型不支持图片与 PDF 输入';
  if (!caps.audio) return '当前模型不支持音频输入';
  return null;
}
