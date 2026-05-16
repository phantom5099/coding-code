import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  code: string;
  language: string;
}

export function CodeBlock({ code, language }: Props) {
  const lines = code.split('\n');

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="cyan" bold>{language}</Text>
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}
