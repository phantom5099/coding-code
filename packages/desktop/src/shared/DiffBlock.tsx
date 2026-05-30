interface DiffBlockProps {
  diff: string
}

export default function DiffBlock({ diff }: DiffBlockProps) {
  const lines = diff.split('\n')
  
  return (
    <div className="rounded-md overflow-hidden border border-[#333]">
      <pre className="text-[12px] leading-[1.5] font-mono overflow-x-auto">
        {lines.map((line, idx) => {
          let bgColor = 'bg-[#1e1e1e]'
          let textColor = 'text-[#d4d4d4]'
          
          if (line.startsWith('+')) {
            bgColor = 'bg-[#1a3a1a]'
            textColor = 'text-[#4ec9b0]'
          } else if (line.startsWith('-')) {
            bgColor = 'bg-[#3a1a1a]'
            textColor = 'text-[#f44747]'
          }
          
          return (
            <div key={idx} className={`${bgColor} ${textColor} px-2`}>
              {line}
            </div>
          )
        })}
      </pre>
    </div>
  )
}
