import { z } from 'zod';
import { Effect } from 'effect';
import type { AgentError, PermissionMode } from '@codingcode/util';
import type { ToolCall, ToolDescription } from '@codingcode/model';
import type { SessionLocator, SessionRef } from '@codingcode/session';
import type { ToolOutcome } from '@codingcode/sink';
import type {
  SandboxConfig,
  SandboxEscalationRequest,
  SandboxPolicy,
  ToolApprovalMetadata,
} from '@codingcode/sandbox';

export type { ToolApprovalMetadata };

export interface ToolDefinition<R = never, TArgs = unknown> {
  name: string;
  /** 是否可与同批其它工具并发；省略即 false（fail-closed） */
  concurrencySafe?: boolean;
  /** 工具固有的审批动作描述，不由工具名推断 */
  approval?: ToolApprovalMetadata;
  /** 解析参数后的动态危险操作描述 */
  describeOperation?: (args: TArgs) => ToolApprovalMetadata;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (args: TArgs, ctx?: ToolExecCtx) => Effect.Effect<string, AgentError, R>;
}

/** 泛型工具构造辅助：按 zod schema 自动推导 execute / describeOperation 的 args 类型 */
export function defineTool<R = never, TSchema extends z.ZodTypeAny = z.ZodTypeAny>(def: {
  name: string;
  concurrencySafe?: boolean;
  approval?: ToolApprovalMetadata;
  describeOperation?: (args: z.infer<TSchema>) => ToolApprovalMetadata;
  description: string;
  parameters: TSchema;
  execute: (args: z.infer<TSchema>, ctx?: ToolExecCtx) => Effect.Effect<string, AgentError, R>;
}): ToolDefinition<R, z.infer<TSchema>> {
  return def;
}

/** 单个工具执行时可见的上下文（封装 SessionLocator，不含编排私有字段 currentTurnId） */
export interface ToolExecCtx {
  readonly session?: SessionLocator;
  readonly signal?: AbortSignal;
  /** 本回合所属智能体的昵称；顶层主智能体缺省 */
  readonly agentName?: string;
  /** 本次调用的 tool_call id；ask_user 用作等待键 */
  readonly callId?: string;
  readonly sandboxPolicy?: SandboxPolicy;
  readonly permissionMode?: PermissionMode;
  readonly sandbox?: SandboxConfig;
  readonly model: string;
}

/** 批次级工具执行上下文值对象：统一封装会话回合引用、沙箱/权限策略与取消信号 */
export interface ToolBatchContext {
  readonly session: SessionRef;
  readonly agentName?: string;
  readonly signal?: AbortSignal;
  readonly permissionMode?: PermissionMode;
  readonly sandbox?: SandboxConfig;
  readonly model: string;
}

export type ToolResult = { readonly id: string; readonly name: string } & ToolOutcome;

export interface ToolRunner {
  readonly name: string;
  readonly concurrencySafe: boolean;
  readonly approval: ToolApprovalMetadata;
  readonly describeOperation: (args: unknown) => ToolApprovalMetadata;
  parse(args: unknown): Record<string, unknown>;
  execute(args: unknown, ctx?: ToolExecCtx): Effect.Effect<string, AgentError>;
}

export type ToolLookup = (name: string) => ToolRunner | undefined;

export interface ToolCatalog {
  tools: ToolDescription[];
  lookup: ToolLookup;
}

export interface ParsedToolCall {
  readonly call: ToolCall;
  readonly runner: ToolRunner;
  readonly parsedArgs: Readonly<Record<string, unknown>>;
  readonly argsHash: string;
  readonly operation: ToolApprovalMetadata;
}

export interface PreparedToolCall extends ParsedToolCall {
  readonly sandboxPolicy: SandboxPolicy;
}

export interface PreparedToolEscalation {
  readonly prepared: PreparedToolCall;
  readonly request: SandboxEscalationRequest;
}

export interface PreparedToolBatch {
  readonly prepared: PreparedToolCall[];
  readonly denied: ToolResult[];
  readonly escalations: PreparedToolEscalation[];
}

export interface PrepareToolBatchRequest {
  readonly toolCalls: readonly ToolCall[];
  readonly context: ToolBatchContext;
  readonly toolLookup: ToolLookup;
}

export interface ExecuteToolBatchRequest {
  readonly toolCalls: readonly (PreparedToolCall | ToolCall)[];
  readonly context: ToolBatchContext;
  readonly toolLookup?: ToolLookup;
}
