import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  children: React.ReactNode;
  width: number;
  title: string;
  titleColor?: string;
  left?: number;
  top?: number;
}

export function CommandOverlay({ children, width, title, titleColor = 'cyan', left = 2, top = 2 }: Props) {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={titleColor}
      padding={1}
      width={width}
      position="absolute"
      top={top}
      left={left}
      backgroundColor="black"
    >
      <Box marginBottom={1}>
        <Text bold color={titleColor}>
          {title}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          [↑↓选择 | Enter确认 | Esc取消]
        </Text>
      </Box>
    </Box>
  );
}
