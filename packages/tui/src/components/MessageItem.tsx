import React from 'react';
import { Box, Text } from 'ink';
import type { UIMessage } from '../types.js';
import { CodeBlock } from './CodeBlock.js';
import { parseCodeBlocks, formatTime } from '../utils.js';

/** Render a single todo step line with colored status icon and step text */
function TodoStep({ line }: { line: string }) {
  const icon = line[0];
  const step = line.slice(2);
  if (icon === '✓') {
    return <Text color="green">{line}</Text>;
  }
  if (icon === '✗') {
    return <Text color="red" dimColor>{line}</Text>;
  }
  return <Text color="yellow">{line}</Text>;
}

interface Props {
  message: UIMessage;
  isFocused?: boolean;
  width: number;
  expanded?: boolean;
  interactive?: boolean;
}

export function MessageItem({ message, isFocused = false, width, expanded = true, interactive = true }: Props) {
  const focusPrefix = interactive && isFocused ? <Text color="yellow">▸ </Text> : null;
  const indent = interactive && isFocused ? 3 : 2;

  if (message.role === 'user') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Box>
          {focusPrefix}
          <Text bold color="blue" wrap="wrap">{'› '}{message.content}</Text>
        </Box>
        <Box paddingLeft={indent}>
          <Text color="gray" dimColor>{formatTime(message.timestamp)}</Text>
        </Box>
      </Box>
    );
  }

  if (message.role === 'tool') {
    // Todo messages: render with colored status icons
    if (message.toolName?.startsWith('Todo')) {
      const lines = message.content.split('\n');
      if (interactive && !expanded) {
        return (
          <Box flexDirection="column" marginY={1} paddingLeft={2}>
            <Box>
              {focusPrefix}
              <Text color="gray" wrap="wrap">[todo] {message.toolName} · Ctrl+O 展开</Text>
            </Box>
          </Box>
        );
      }
      return (
        <Box flexDirection="column" marginY={1} paddingLeft={2}>
          <Box>
            {focusPrefix}
            <Text color="magenta" bold>[todo] {message.toolName}</Text>
          </Box>
          <Box flexDirection="column" paddingLeft={1}>
            {lines.map((line, i) => (
              <TodoStep key={i} line={line} />
            ))}
          </Box>
        </Box>
      );
    }
    // Regular tool messages
    if (interactive && !expanded) {
      return (
        <Box flexDirection="column" marginY={1} paddingLeft={2}>
          <Box>
            {focusPrefix}
            <Text color="gray" wrap="wrap">[tool: {message.toolName}] {message.content.length} chars · Ctrl+O 展开</Text>
          </Box>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" marginY={1} paddingLeft={2}>
        <Box>
          {focusPrefix}
          <Text color="magenta" bold>[tool: {message.toolName}]</Text>
        </Box>
        <Text color="gray" dimColor>{message.content}</Text>
      </Box>
    );
  }

  if (message.role === 'welcome') {
    return (
      <Box flexDirection="column" marginY={1} paddingLeft={2}>
        <Text color="cyan" bold>{message.content}</Text>
      </Box>
    );
  }

  if (message.role === 'system') {
    return (
      <Box flexDirection="column" marginY={1} paddingLeft={2}>
        <Box>
          {focusPrefix}
          <Text color="red" wrap="wrap">{message.content}</Text>
        </Box>
      </Box>
    );
  }

  // assistant
  const blocks = parseCodeBlocks(message.content);

  if (interactive && !expanded) {
    const preview = message.content.slice(0, 80).replace(/\n/g, ' ');
    return (
      <Box flexDirection="column" marginY={1}>
        <Box>
          {focusPrefix}
          <Text bold color="green">AI</Text>
          {message.isStreaming && <Text color="gray"> {'⠋'}</Text>}
          {message.model && <Text color="gray" dimColor> · {message.model}</Text>}
        </Box>
        <Box paddingLeft={indent}>
          <Text color="gray" dimColor>{preview}{message.content.length > 80 ? '...' : ''} · Ctrl+O 展开</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        {focusPrefix}
        <Text bold color="green">AI</Text>
        {message.isStreaming && <Text color="gray"> {'⠋'}</Text>}
        {message.model && <Text color="gray" dimColor> · {message.model}</Text>}
      </Box>
      <Box paddingLeft={indent} flexDirection="column">
        {blocks.map((block, i) => (
          <Box key={i} flexDirection="column">
            {block.type === 'text' ? (
              <Text wrap="wrap">{block.content}</Text>
            ) : (
              <CodeBlock code={block.content} language={block.language || 'text'} />
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
