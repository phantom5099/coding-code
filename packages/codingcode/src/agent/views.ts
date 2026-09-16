import type { CheckpointShape } from '../checkpoint/port.js';
import type { ContextShape } from '../context/port.js';
import type { HookShape } from '../hooks/port.js';
import type { LLMFactoryShape } from '../llm/port.js';
import type { McpShape } from '../mcp/port.js';
import type { MemoryShape } from '../memory/port.js';
import type { SessionShape } from '../session/port.js';
import type { SkillShape } from '../skills/port.js';
import type { TodoShape } from '../todo/port.js';

export type AgentCheckpoint = Pick<CheckpointShape, 'snapshotBaseline' | 'snapshotFinal'>;

export type AgentContext = Pick<ContextShape, 'willCompact' | 'assemblePayload'>;

export type AgentHooks = Pick<HookShape, 'emit' | 'emitDecision' | 'reloadUserHooks' | 'disposeSession'>;

export type AgentLlmFactory = Pick<LLMFactoryShape, 'getLLMClient'>;

export type AgentMcp = Pick<McpShape, 'syncConnections'>;

export type AgentMemory = Pick<MemoryShape, 'loadMemoryForPrompt' | 'flushSessionToMemory'>;

export type AgentSession = Pick<SessionShape, 'load' | 'create' | 'recordUser' | 'recordSystem' | 'recordAssistant' | 'recordToolResult' | 'setPermissionMode' | 'setActiveProfile'>;

export type AgentSkills = Pick<SkillShape, 'extractSkill'>;

export type AgentTodos = Pick<TodoShape, 'read'>;
