import React from 'react';
import { Box, Text } from 'ink';
import { marked, Token, Tokens } from 'marked';
import { CodeBlock } from './CodeBlock.js';

interface MarkdownTextProps {
  content: string;
  width: number;
}

marked.setOptions({ gfm: true, breaks: true });

function renderInlineTokens(tokens: Token[] | undefined, width: number): React.ReactNode[] {
  if (!tokens || tokens.length === 0) return [];

  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text;
        nodes.push(<Text key={i}>{t.text}</Text>);
        break;
      }
      case 'strong': {
        const t = token as Tokens.Strong;
        nodes.push(
          <Text key={i} bold>
            {renderInlineTokens(t.tokens, width)}
          </Text>
        );
        break;
      }
      case 'em': {
        const t = token as Tokens.Em;
        nodes.push(
          <Text key={i} italic>
            {renderInlineTokens(t.tokens, width)}
          </Text>
        );
        break;
      }
      case 'codespan': {
        const t = token as Tokens.Codespan;
        nodes.push(
          <Text key={i} color="cyan" backgroundColor="#333">
            {' '}
            {t.text}{' '}
          </Text>
        );
        break;
      }
      case 'link': {
        const t = token as Tokens.Link;
        nodes.push(
          <React.Fragment key={i}>
            <Text color="blue" underline>
              {renderInlineTokens(t.tokens, width)}
            </Text>
            <Text color="gray"> ({t.href})</Text>
          </React.Fragment>
        );
        break;
      }
      case 'br':
        nodes.push(<Text key={i}>{'\n'}</Text>);
        break;
      case 'escape': {
        const t = token as Tokens.Escape;
        nodes.push(<Text key={i}>{t.text}</Text>);
        break;
      }
      default:
        if ('text' in token && typeof token.text === 'string') {
          nodes.push(<Text key={i}>{token.text}</Text>);
        } else if ('raw' in token && typeof token.raw === 'string') {
          nodes.push(<Text key={i}>{token.raw}</Text>);
        }
        break;
    }
  }
  return nodes;
}

function renderList(
  items: Tokens.ListItem[],
  width: number,
  ordered: boolean,
  start: number | '' = 1
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const prefix = ordered ? `${(Number(start) || 1) + i}. ` : '• ';
    const inlineNodes = renderInlineTokens(item.tokens, width);

    const subListNodes: React.ReactNode[] = [];
    if (item.tokens) {
      for (const subToken of item.tokens) {
        if (subToken.type === 'list') {
          const subList = subToken as Tokens.List;
          subListNodes.push(
            <Box key={`sub-${i}`} paddingLeft={2} flexDirection="column">
              {renderList(subList.items, width, subList.ordered, subList.start)}
            </Box>
          );
        }
      }
    }

    nodes.push(
      <Box key={i} flexDirection="column">
        <Box>
          <Text color="gray">{prefix}</Text>
          <Box flexDirection="column">{inlineNodes}</Box>
        </Box>
        {subListNodes}
      </Box>
    );
  }
  return nodes;
}

function renderTable(token: Tokens.Table, width: number): React.ReactNode {
  const { header, rows } = token;
  const colCount = header.length;

  const colWidths = header.map((h, i) => {
    const headerLen = h.text.length;
    const maxRowLen = Math.max(...rows.map((r) => r[i]?.text.length ?? 0));
    return Math.min(
      Math.max(headerLen, maxRowLen) + 1,
      Math.floor((width - colCount - 1) / colCount)
    );
  });

  const renderRow = (cells: Tokens.TableCell[], isHeader: boolean) => {
    const parts = cells.map((cell, i) => {
      const cw = colWidths[i] ?? 0;
      const text = cell.text.padEnd(cw).slice(0, cw);
      return isHeader ? <Text bold>{text}</Text> : <Text>{text}</Text>;
    });
    const separator = <Text color="gray"> │ </Text>;
    return (
      <Box>
        <Text color="gray">│ </Text>
        {parts.flatMap((node, i) => (i === 0 ? [node] : [separator, node]))}
        <Text color="gray"> │</Text>
      </Box>
    );
  };

  const separatorLine = '├' + colWidths.map((w) => '─'.repeat(w)).join('┼') + '┤';

  return (
    <Box flexDirection="column" marginY={1}>
      {renderRow(header, true)}
      <Text color="gray">{separatorLine}</Text>
      {rows.map((row, i) => (
        <React.Fragment key={i}>{renderRow(row, false)}</React.Fragment>
      ))}
    </Box>
  );
}

export function MarkdownText({ content, width }: MarkdownTextProps) {
  const tokens = marked.lexer(content);

  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;

    switch (token.type) {
      case 'heading': {
        const headingToken = token as Tokens.Heading;
        const prefix = '#'.repeat(headingToken.depth) + ' ';
        const colors = ['yellow', 'yellow', 'green', 'cyan', 'gray', 'gray'] as const;
        nodes.push(
          <Box key={i} flexDirection="column" marginY={1}>
            <Text bold color={colors[headingToken.depth - 1] ?? 'gray'}>
              {prefix}
              {renderInlineTokens(headingToken.tokens, width)}
            </Text>
          </Box>
        );
        break;
      }
      case 'paragraph': {
        const paraToken = token as Tokens.Paragraph;
        nodes.push(
          <Box key={i} flexDirection="column">
            <Text wrap="wrap">{renderInlineTokens(paraToken.tokens, width)}</Text>
          </Box>
        );
        break;
      }
      case 'code': {
        const codeToken = token as Tokens.Code;
        nodes.push(<CodeBlock key={i} code={codeToken.text} language={codeToken.lang || 'text'} />);
        break;
      }
      case 'list': {
        const listToken = token as Tokens.List;
        nodes.push(
          <Box key={i} flexDirection="column" paddingLeft={1}>
            {renderList(listToken.items, width, listToken.ordered, listToken.start)}
          </Box>
        );
        break;
      }
      case 'blockquote': {
        const bqToken = token as Tokens.Blockquote;
        const innerText = bqToken.tokens
          .map((t) => {
            if ('text' in t) return t.text;
            if ('raw' in t) return t.raw;
            return '';
          })
          .join('\n');
        nodes.push(
          <Box key={i} flexDirection="column" paddingLeft={1} marginY={0}>
            <Text color="gray">│ {innerText}</Text>
          </Box>
        );
        break;
      }
      case 'hr': {
        nodes.push(
          <Text key={i} color="gray">
            {'─'.repeat(Math.min(width - 2, 60))}
          </Text>
        );
        break;
      }
      case 'table': {
        const tableToken = token as Tokens.Table;
        nodes.push(<React.Fragment key={i}>{renderTable(tableToken, width)}</React.Fragment>);
        break;
      }
      case 'space':
        break;
      default:
        if ('raw' in token && typeof token.raw === 'string') {
          nodes.push(
            <Text key={i} wrap="wrap">
              {token.raw}
            </Text>
          );
        }
        break;
    }
  }

  return <Box flexDirection="column">{nodes}</Box>;
}
