import React from 'react';
import { Box, Text } from 'ink';

interface Role {
  id: string;
  label: string;
  description: string;
}

interface Props {
  roles: Role[];
  currentRole: string;
  selectedIndex: number;
  width: number;
}

export function RolePicker({ roles, currentRole, selectedIndex, width }: Props) {
  const maxLen = Math.max(0, width - 4);

  return (
    <Box flexDirection="column" height={Math.min(roles.length, 8)}>
      {roles.map((r, i) => {
        const isCurrent = r.id === currentRole;
        const isSelected = i === selectedIndex;
        const prefix = `${isSelected ? '▸ ' : '  '}${isCurrent ? '● ' : '  '}`;
        const suffix = `  ${r.description}`;
        const line = `${prefix}${r.label}${suffix}`.slice(0, maxLen);

        return (
          <Box key={r.id}>
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
