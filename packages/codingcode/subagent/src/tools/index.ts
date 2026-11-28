import type { ToolDefinition } from '@codingcode/tool';
import { spawnAgentTool } from './spawn.js';
import {
  waitAgentTool,
  SUBAGENT_WAIT_MIN_MS,
  SUBAGENT_WAIT_DEFAULT_MS,
  SUBAGENT_WAIT_MAX_MS,
} from './wait.js';
import { resumeAgentTool } from './resume.js';
import { sendMessageTool } from './message.js';
import { interruptAgentTool } from './interrupt.js';
import { listAgentsTool } from './list.js';

export {
  spawnAgentTool,
  waitAgentTool,
  SUBAGENT_WAIT_MIN_MS,
  SUBAGENT_WAIT_DEFAULT_MS,
  SUBAGENT_WAIT_MAX_MS,
  resumeAgentTool,
  sendMessageTool,
  interruptAgentTool,
  listAgentsTool,
};

export const SUBAGENT_TOOLS: readonly ToolDefinition<any, any>[] = [
  spawnAgentTool,
  waitAgentTool,
  resumeAgentTool,
  sendMessageTool,
  interruptAgentTool,
  listAgentsTool,
];
