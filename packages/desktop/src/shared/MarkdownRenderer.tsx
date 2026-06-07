import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import CodeBlock from './CodeBlock';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const components = useMemo(
    () => ({
      code(props: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) {
        const { children, className: codeClassName, ...rest } = props;
        const match = /language-(\w+)/.exec(codeClassName || '');
        const language = match ? match[1] : undefined;
        const codeString = String(children).replace(/\n$/, '');

        if (codeClassName || codeString.includes('\n')) {
          return <CodeBlock code={codeString} language={language} />;
        }

        return (
          <code className="md-inline-code" {...rest}>
            {children}
          </code>
        );
      },
      pre(props: React.HTMLAttributes<HTMLElement>) {
        const { children } = props;
        return <>{children}</>;
      },
      a(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
        const { href, children, ...rest } = props;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className="md-link" {...rest}>
            {children}
          </a>
        );
      },
      h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h1 className="md-h1" {...props} />,
      h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h2 className="md-h2" {...props} />,
      h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className="md-h3" {...props} />,
      h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h4 className="md-h4" {...props} />,
      h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h5 className="md-h5" {...props} />,
      h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h6 className="md-h6" {...props} />,
      p: (props: React.HTMLAttributes<HTMLParagraphElement>) => <p className="md-p" {...props} />,
      ul: (props: React.HTMLAttributes<HTMLUListElement>) => <ul className="md-ul" {...props} />,
      ol: (props: React.HTMLAttributes<HTMLOListElement>) => <ol className="md-ol" {...props} />,
      li: (props: React.HTMLAttributes<HTMLLIElement>) => <li className="md-li" {...props} />,
      blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => <blockquote className="md-blockquote" {...props} />,
      table: (props: React.TableHTMLAttributes<HTMLTableElement>) => (
        <div className="md-table-wrapper">
          <table className="md-table" {...props} />
        </div>
      ),
      hr: () => <hr className="md-hr" />,
      img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img className="md-img" {...props} />,
      strong: (props: React.HTMLAttributes<HTMLElement>) => <strong className="md-strong" {...props} />,
      em: (props: React.HTMLAttributes<HTMLElement>) => <em className="md-em" {...props} />,
    }),
    []
  );

  return (
    <div className={`markdown-body ${className || ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
