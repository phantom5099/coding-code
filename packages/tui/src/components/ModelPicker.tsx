import React from 'react';
import { Box, Text } from 'ink';
type SelectableModel = { id: string; name: string; provider: string; model: string };

interface Props {
  models: SelectableModel[];
  activeId: string;
  selectedIndex: number;
  width: number;
  maxHeight?: number;
}

export function ModelPicker({ models, activeId, selectedIndex, width, maxHeight }: Props) {
  const maxLen = Math.max(0, width - 4);

  return (
    <Box flexDirection="column" height={Math.min(models.length, maxHeight ?? 8)}>
      {models.map((m, i) => {
        const isActive = m.id === activeId;
        const isSelected = i === selectedIndex;
        const prefix = `${isSelected ? '▸ ' : '  '}${isActive ? '● ' : '  '}`;
        const suffix = `  ${m.provider}/${m.model}`;
        const line = `${prefix}${m.name}${suffix}`.slice(0, maxLen);

        return (
          <Box key={m.id}>
            <Text
              backgroundColor={isSelected ? 'cyan' : undefined}
              color={isSelected ? 'black' : 'white'}
              bold={isSelected}
              wrap="truncate-end"
            >
              {line}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
