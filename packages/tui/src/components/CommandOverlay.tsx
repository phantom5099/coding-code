import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  children: React.ReactNode;
  width: number;
  title: string;
  titleColor?: string;
  left?: number;
  top?: number;
  position?: 'absolute' | 'relative';
}

export function CommandOverlay({ children, width, title, titleColor = 'cyan', left, top, position = 'absolute' }: Props) {
  const posProps = position === 'absolute' ? { position: 'absolute' as const, top: top ?? 2, left: left ?? 2 } : {};

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={titleColor}
      padding={1}
      width={width}
      backgroundColor="black"
      {...posProps}
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
