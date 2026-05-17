import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  onSubmit: (input: string) => void;
  disabled?: boolean;
  width?: number;
}

export function InputBox({ onSubmit, disabled, width = 80 }: Props) {
  const [input, setInput] = useState('');

  const handleSubmit = (value: string) => {
    if (!value.trim()) return;
    onSubmit(value);
    setInput('');
  };

  const borderColor = disabled ? 'gray' : 'blue';
  const w = Math.max(20, width - 4);

  return (
    <Box flexDirection="column">
      <Text color={borderColor}>{'─'.repeat(w)}</Text>
      <Box paddingX={1}>
        <Text color="blue" bold>{'> '}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={disabled ? '等待中...' : '输入消息或 /命令...'}
          focus={!disabled}
        />
      </Box>
      <Text color={borderColor}>{'─'.repeat(w)}</Text>
    </Box>
  );
}
