import type { ToolDefinition } from '@codingcode/tool';
import { FS_TOOLS } from '@codingcode/fs';
import { BASH_TOOLS } from '@codingcode/bash';
import { WEB_TOOLS } from '@codingcode/web';
import { SELF_TOOLS } from '@codingcode/self';
import { SUBAGENT_TOOLS } from '@codingcode/subagent';

export const ALL_BUILTIN_TOOLS: readonly ToolDefinition<any, any>[] = [
  ...FS_TOOLS,
  ...BASH_TOOLS,
  ...WEB_TOOLS,
  ...SELF_TOOLS,
  ...SUBAGENT_TOOLS,
];
