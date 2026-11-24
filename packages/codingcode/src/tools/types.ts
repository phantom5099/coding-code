import { z } from 'zod';
import { Effect } from 'effect';
import type { AgentError } from '../util/error.js';
import type { ToolDescription } from '../llm/types.js';
import type { PermissionMode } from '../util/enums.js';
import type { ToolOutcome } from '../sink/types.js';
import type {
  DangerousOperation,
  SandboxEscalationRequest,
  SandboxMode,
  SandboxPolicy,
} from '../sandbox/types.js';

export type ToolApprovalAction =
  | 'file'
  | 'exec'
  | 'network'
  | 'mcp'
  | 'subagent'
  | 'sandbox'
  | 'other';

export interface ToolApprovalMetadata {
  readonly action: ToolApprovalAction;
  readonly requiresConfirmation?: boolean;
  readonly dangerous?: readonly DangerousOperation[];
  readonly network?: { readonly hosts: readonly string[]; readonly ports: readonly number[] };
  readonly workspace?: { readonly paths: readonly string[]; readonly write: boolean };
}

export interface ToolDefinition<R = never> {
  name: string;
  /** 是否可与同批其它工具并发；省略即 false（fail-closed） */
  concurrencySafe?: boolean;
  /** 工具固有的审批动作描述，不由工具名推断。 */
  approval?: ToolApprovalMetadata;
  /** 解析参数后的动态危险操作描述。 */
  describeOperation?: (args: unknown) => ToolApprovalMetadata;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (args: unknown, ctx?: ToolExecCtx) => Effect.Effect<string, AgentError, R>;
}

export interface ToolExecCtx {
  signal?: AbortSignal;
  sessionId?: string;
  /** 祖先会话 id，由近及远：[直接父, 祖父, ..., 根]；缺省即顶层主智能体（[]）
   *  —— 主智能体判定 = 数组为空；直接父 = parentChain[0]；
   *  任意祖先的 transcript 路径按「链条下一跳即其父」算出 */
  parentChain?: readonly string[];
  /** 本回合所属智能体的昵称；顶层主智能体缺省 */
  agentName?: string;
  /** 本次调用的 tool_call id（由 execSingle 以 tc.id 注入）；ask_user 用作等待键 */
  callId?: string;
  projectPath?: string;
  sandboxPolicy?: SandboxPolicy;
  permissionMode?: PermissionMode;
  sandboxMode?: SandboxMode;
  parentPolicy?: SandboxPolicy;
  model: string;
}

export type ToolResult = { readonly id: string; readonly name: string } & ToolOutcome;

export interface ToolRunner {
  readonly name: string;
  readonly concurrencySafe: boolean;
  readonly approval: ToolApprovalMetadata;
  readonly describeOperation: (args: unknown) => ToolApprovalMetadata;
  parse(args: unknown): unknown;
  execute(args: unknown, ctx?: ToolExecCtx): Effect.Effect<string, AgentError>;
}

export type ToolLookup = (name: string) => ToolRunner | undefined;

export type ToolExecOpts = Omit<ToolExecCtx, 'sessionId' | 'callId'> & {
  turnId?: number;
};

export type ToolExecCall = ToolExecOpts & { sessionId?: string; callId?: string };

export interface ToolCatalog {
  tools: ToolDescription[];
  lookup: ToolLookup;
}

export interface ParsedToolCall {
  readonly call: import('../llm/types.js').ToolCall;
  readonly runner: ToolRunner;
  readonly parsedArgs: unknown;
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
