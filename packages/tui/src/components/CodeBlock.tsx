import React from 'react';
import { Box, Text } from 'ink';
import { highlight } from 'cli-highlight';

interface Props {
  code: string;
  language: string;
}

export function CodeBlock({ code, language }: Props) {
  let highlighted: string;
  try {
    highlighted = highlight(code, { language, theme: {
      keyword: '\x1b[56m',
      built_in: '\x1b[36m',
      type: '\x1b[4m\x1b[36m',
      literal: '\x1b[35m',
      number: '\x1b[35m',
      string: '\x1b[32m',
      comment: '\x1b[90m',
      function: '\x1b[33m',
      variable: '\x1b[37m',
      attr: '\x1b[36m',
      tag: '\x1b[34m',
      name: '\x1b[33m',
      attribute: '\x1b[36m',
      punctuation: '\x1b[37m',
      meta: '\x1b[90m',
    }});
  } catch {
    highlighted = code;
  }

  const lines = highlighted.split('\n');

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="cyan" bold>
        {language}
      </Text>
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}
