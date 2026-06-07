import { useEffect, useRef } from 'react';
import Prism from 'prismjs';
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

interface CodeBlockProps {
  code: string;
  language?: string;
}

export default function CodeBlock({ code, language }: CodeBlockProps) {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current && language && Prism.languages[language]) {
      Prism.highlightElement(codeRef.current);
    }
  }, [code, language]);

  const lang = language && Prism.languages[language] ? language : 'text';

  return (
    <div className="relative group my-1 rounded overflow-hidden bg-[var(--bg-card)] border border-[var(--border-strong)]">
      {language && (
        <div className="px-3 py-1 text-xs text-[var(--text-muted)] bg-[var(--border-default)] border-b border-[var(--border-strong)] font-mono">
          {language}
        </div>
      )}
      <pre className="p-3 text-[13px] font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap break-all m-0">
        <code ref={codeRef} className={`language-${lang}`}>
          {code}
        </code>
      </pre>
    </div>
  );
}
