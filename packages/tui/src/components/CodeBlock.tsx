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
    highlighted = highlight(code, {
      language,
      theme: {
        keyword: (s) => `\x1b[56m${s}\x1b[0m`,
        built_in: (s) => `\x1b[36m${s}\x1b[0m`,
        type: (s) => `\x1b[4m\x1b[36m${s}\x1b[0m`,
        literal: (s) => `\x1b[35m${s}\x1b[0m`,
        number: (s) => `\x1b[35m${s}\x1b[0m`,
        string: (s) => `\x1b[32m${s}\x1b[0m`,
        comment: (s) => `\x1b[90m${s}\x1b[0m`,
        function: (s) => `\x1b[33m${s}\x1b[0m`,
        variable: (s) => `\x1b[37m${s}\x1b[0m`,
        attr: (s) => `\x1b[36m${s}\x1b[0m`,
        tag: (s) => `\x1b[34m${s}\x1b[0m`,
        name: (s) => `\x1b[33m${s}\x1b[0m`,
        attribute: (s) => `\x1b[36m${s}\x1b[0m`,
        meta: (s) => `\x1b[90m${s}\x1b[0m`,
      } as Record<string, (codePart: string) => string>,
    });
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
