import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export function LoadingIndicator() {
  return (
    <Box paddingLeft={2}>
      <Text color="green">
        <Spinner type="dots" />
        {' '}AI 思考中...
      </Text>
    </Box>
  );
}
