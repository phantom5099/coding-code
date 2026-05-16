import React from 'react';
import { Box, Text } from 'ink';
import type { SessionIndex } from '../../../session/types';

interface Props {
  sessions: SessionIndex[];
  selectedIndex: number;
  width: number;
}

export function SessionPicker({ sessions, selectedIndex, width }: Props) {
  const maxLen = Math.max(0, width - 4);

  return (
    <Box flexDirection="column" height={Math.min(sessions.length * 2, 8)}>
      {sessions.map((s, i) => {
        const isSelected = i === selectedIndex;
        const date = new Date(s.createdAt).toLocaleString();
        const line1 = `${isSelected ? '▸ ' : '  '}${s.sessionId.slice(0, 8)}  (${s.messageCount} msgs)`.slice(0, maxLen);
        const line2 = `    model=${s.model} role=${s.role} ${date}`.slice(0, maxLen);

        return (
          <Box key={s.sessionId} flexDirection="column">
            <Text
              backgroundColor={isSelected ? 'yellow' : undefined}
              color={isSelected ? 'black' : 'white'}
              bold={isSelected}
              wrap="truncate-end"
            >
              {line1}
            </Text>
            <Text
              backgroundColor={isSelected ? 'yellow' : undefined}
              color={isSelected ? 'black' : 'gray'}
              dimColor={!isSelected}
              wrap="truncate-end"
            >
              {line2}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
