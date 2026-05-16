import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  width: number;
}

export function HelpOverlay({ width }: Props) {
  const maxLen = Math.max(0, width - 4);

  const line = (cmd: string, desc: string) =>
    `${cmd.padEnd(12)}${desc}`.slice(0, maxLen);

  return (
    <Box flexDirection="column">
      <Box marginY={1}>
        <Text bold>Commands:</Text>
      </Box>
      <Box paddingLeft={2} flexDirection="column">
        <Text color="gray" dimColor>{line('/model', '选择模型')}</Text>
        <Text color="gray" dimColor>{line('/role', '选择角色')}</Text>
        <Text color="gray" dimColor>{line('/sessions', '恢复历史会话')}</Text>
        <Text color="gray" dimColor>{line('/clear', '清空上下文并开始新会话')}</Text>
        <Text color="gray" dimColor>{line('/debug', '显示调试信息')}</Text>
        <Text color="gray" dimColor>{line('/help', '显示此帮助')}</Text>
        <Text color="gray" dimColor>{line('/exit', '退出')}</Text>
      </Box>
      <Box marginY={1}>
        <Text bold>Shortcuts:</Text>
      </Box>
      <Box paddingLeft={2} flexDirection="column">
        <Text color="gray" dimColor>{line('↑/↓', '聚焦消息')}</Text>
        <Text color="gray" dimColor>{line('Ctrl+O', '展开/折叠消息')}</Text>
      </Box>
    </Box>
  );
}
