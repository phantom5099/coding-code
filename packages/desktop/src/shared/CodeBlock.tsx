import { useEffect, useRef } from 'react';
import Prism from 'prismjs';
import { Copy, Check } from 'lucide-react';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

interface CodeBlockProps {
  code: string;
  language?: string;
}

export default function CodeBlock({ code, language }: CodeBlockProps) {
  const codeRef = useRef<HTMLElement>(null);
  const { copiedId, copy } = useCopyToClipboard();
  const codeKey = `code-${code.slice(0, 20)}`;
  const isCopied = copiedId === codeKey;

  useEffect(() => {
    if (codeRef.current && language && Prism.languages[language]) {
      Prism.highlightElement(codeRef.current);
    }
  }, [code, language]);

  const lang = language && Prism.languages[language] ? language : 'text';

  return (
    <div className="relative group my-1 rounded overflow-hidden bg-[var(--bg-card)] border border-[var(--border-strong)]">
      {language && (
        <div className="flex items-center justify-between px-3 py-1 text-xs text-[var(--text-muted)] bg-[var(--border-default)] border-b border-[var(--border-strong)] font-mono">
          <span>{language}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              copy(code, codeKey);
            }}
            aria-label="复制代码"
            title="复制"
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-all opacity-0 group-hover:opacity-100 ${
              isCopied
                ? 'bg-[var(--accent-success)] text-[var(--text-inverse)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {isCopied ? <Check size={12} /> : <Copy size={12} />}
            {isCopied ? '已复制' : '复制'}
          </button>
        </div>
      )}
      {!language && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            copy(code, codeKey);
          }}
          aria-label="复制代码"
          title="复制"
          className={`absolute top-1 right-1 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-all opacity-0 group-hover:opacity-100 ${
            isCopied
              ? 'bg-[var(--accent-success)] text-[var(--text-inverse)]'
              : 'bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)]'
          }`}
        >
          {isCopied ? <Check size={12} /> : <Copy size={12} />}
          {isCopied ? '已复制' : '复制'}
        </button>
      )}
      <pre className="p-3 text-[13px] font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap break-all m-0">
        <code ref={codeRef} className={`language-${lang}`}>
          {code}
        </code>
      </pre>
    </div>
  );
}
