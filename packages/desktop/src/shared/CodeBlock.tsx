interface CodeBlockProps {
  code: string
  language?: string
}

export default function CodeBlock({ code, language }: CodeBlockProps) {
  return (
    <div className="relative group my-1 rounded overflow-hidden bg-[#1a1a1a] border border-[#333]">
      {language && (
        <div className="px-3 py-1 text-xs text-[#666] bg-[#222] border-b border-[#333] font-mono">
          {language}
        </div>
      )}
      <pre className="p-3 text-[13px] font-mono text-[#d4d4d4] overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
        <code>{code}</code>
      </pre>
    </div>
  )
}
