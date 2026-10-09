import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, X } from 'lucide-react';
import { API_BASE } from '../lib/api';
import { mediaKindOf, srcOf, type ContentPart } from '@shared/parts';

interface MediaViewProps {
  part: ContentPart;
  /** 资产按项目定位：落盘形态的媒体需要一个 cwd 才拼得出地址 */
  cwd?: string;
  /** 输入区的附件条用紧凑尺寸，且不弹大图 */
  compact?: boolean;
}

function formatBytes(n: number | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSeconds(sec: number | undefined): string {
  if (sec == null) return '';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 一段媒体块的渲染：图片给缩略图并可点开放大、音频给播放器、其余（PDF）
 * 给文件条目。读不到字节时降级成与 `textOf` 同形的方括号标记 —— 服务端
 * `resolveAssets` 未命中时也是这个口径。
 */
export default function MediaView({ part, cwd, compact }: MediaViewProps) {
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const closeZoom = useCallback(() => setZoomed(false), []);

  if (part.type !== 'media') return null;

  const kind = mediaKindOf(part.mimeType);
  const src = srcOf(part, cwd ?? '', API_BASE);
  const filename = part.filename;
  const bytes = 'bytes' in part ? part.bytes : undefined;
  const size = formatBytes(bytes);

  if (failed) {
    return <span className="text-[12px] text-[var(--text-muted)]">[{kind}]</span>;
  }

  if (kind === 'image') {
    return (
      <>
        <img
          src={src}
          alt={filename ?? 'image'}
          onError={() => setFailed(true)}
          onClick={compact ? undefined : () => setZoomed(true)}
          className={`rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] object-contain ${
            compact ? 'max-h-[72px] max-w-[120px]' : 'max-h-[240px] max-w-[280px] cursor-zoom-in'
          }`}
        />
        {zoomed &&
          createPortal(
            <div
              className="fixed inset-0 z-[100] bg-[var(--overlay-bg)] flex items-center justify-center p-8 cursor-zoom-out"
              onClick={closeZoom}
            >
              <button
                type="button"
                onClick={closeZoom}
                aria-label="关闭大图"
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X size={16} />
              </button>
              <img
                src={src}
                alt={filename ?? 'image'}
                className="max-w-full max-h-full object-contain rounded-lg"
              />
            </div>,
            document.body
          )}
      </>
    );
  }

  if (kind === 'audio') {
    const duration = 'durationSec' in part ? part.durationSec : undefined;
    return (
      <div className={`flex flex-col gap-1 ${compact ? '' : 'items-end'}`}>
        <audio
          src={src}
          controls
          onError={() => setFailed(true)}
          className={compact ? 'h-8 max-w-[220px]' : 'h-9 max-w-[300px]'}
        />
        {(filename || duration != null) && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {[filename, formatSeconds(duration), size].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
    );
  }

  const label = filename ?? 'file';

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      title={label}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-hover)] border border-[var(--border-card)] hover:border-[var(--border-hover)] max-w-[280px]"
    >
      <FileText size={16} className="shrink-0 text-[var(--text-tertiary)]" />
      <span className="truncate text-[12px] text-[var(--text-primary)]">{label}</span>
      {size && <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{size}</span>}
    </a>
  );
}
