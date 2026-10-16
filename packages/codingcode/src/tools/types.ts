import { z } from 'zod';
import { Effect } from 'effect';
import type { AgentError } from '../util/error.js';
import type { ToolDescription } from '../llm/types.js';
import type { ProfileName } from '../util/enums.js';
import type { ToolOutcome } from '../sink/types.js';

export interface ToolDefinition<R = never> {
  name: string;
  /** 是否可与同批其它工具并发；省略即 false（fail-closed） */
  concurrencySafe?: boolean;
  /** 执行后会改动工作区（写文件 / bash / 派生子代理 / MCP）；触发惰性 baseline 快照 */
  mutatesWorkspace?: boolean;
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
  activeProfile?: ProfileName;
  model: string;
}

export type ToolResult = { readonly id: string; readonly name: string } & ToolOutcome;

export interface ToolRunner {
  readonly name: string;
  readonly concurrencySafe: boolean;
  readonly mutatesWorkspace: boolean;
  parse(args: unknown): unknown;
  execute(args: unknown, ctx?: ToolExecCtx): Effect.Effect<string, AgentError>;
}

export type ToolLookup = (name: string) => ToolRunner | undefined;

export type ToolExecOpts = Omit<ToolExecCtx, 'sessionId' | 'callId'> & {
  turnId?: number;
  onBeforeMutation?: Effect.Effect<void>;
};

export type ToolExecCall = ToolExecOpts & { sessionId?: string; callId?: string };

export interface ToolCatalog {
  tools: ToolDescription[];
  lookup: ToolLookup;
}
