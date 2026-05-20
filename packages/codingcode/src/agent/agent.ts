import { Effect } from 'effect';
import type { Message, ToolCall } from '../core/types.js';
import { AgentError } from '../core/error.js';
import { Result } from '../core/result.js';
import type { AgentEvent } from '../bus/types.js';
import type { ToolDescription } from '../tools/types.js';
import { ToolService } from '../tools/registry.js';
import { ToolExecutorService } from '../tools/executor.js';
import { buildSystemPrompt } from '../prompts/index.js';
import { resolveConfig } from './config.js';

interface LLMStreamAdapter {
  completeStream(params: {
    messages: Message[];
    system?: string;
    tools?: ToolDescription[];
    maxSteps?: number;
  }): {
    stream: AsyncIterable<string>;
    response: Promise<Result<{ content: string; toolCalls?: ToolCall[] }, AgentError>>;
  };
}

type ToolResultUnion =
  | { type: 'ok'; id: string; name: string; output: string }
  | { type: 'denied'; id: string; name: string; reason: string }
  | { type: 'error'; id: string; name: string; output: string };

function execTool(executor: ToolExecutorService, tc: ToolCall, sessionId: string): Effect.Effect<ToolResultUnion> {
  return executor.execute(tc.name, tc.arguments ?? {}, { sessionId }).pipe(
    Effect.matchEffect({
      onSuccess: (output): Effect.Effect<ToolResultUnion> =>
        Effect.succeed({ type: 'ok' as const, id: tc.id, name: tc.name, output }),
      onFailure: (err): Effect.Effect<ToolResultUnion> => {
        if (err instanceof AgentError && err.code === 'TOOL_NOT_ALLOWED') {
          return Effect.succeed({ type: 'denied' as const, id: tc.id, name: tc.name, reason: err.message });
        }
        const code = err instanceof AgentError ? err.code : 'TOOL_EXECUTION_FAILED';
        const msg = err instanceof AgentError ? err.message : String(err);
        return Effect.succeed({ type: 'error' as const, id: tc.id, name: tc.name, output: `[Error: ${code}] ${msg}` });
      },
    }),
    Effect.catchAllDefect((defect) =>
      Effect.succeed({ type: 'error' as const, id: tc.id, name: tc.name, output: `[Unexpected] ${String(defect)}` }),
    ),
  );
}

export class AgentService extends Effect.Service<AgentService>()('Agent', {
  effect: Effect.gen(function* () {
    const executor = yield* ToolExecutorService;
    const toolRegistry = yield* ToolService;
    const maxSteps = resolveConfig().maxSteps;

    return {
      runStream: (
        messages: Message[],
        llm: LLMStreamAdapter,
        sessionId: string,
        skillInstruction?: string,
      ): AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown> =>
        runReActLoop(messages, maxSteps, llm, executor, toolRegistry, sessionId, skillInstruction),
    };
  }),
}) {}

export async function* runReActLoop(
  initialMessages: Message[],
  maxSteps: number,
  llm: LLMStreamAdapter,
  executor: ToolExecutorService,
  toolRegistry: ToolService,
  sessionId: string,
  skillInstruction?: string,
): AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown> {
  const messages = [...initialMessages];
  const basePrompt = buildSystemPrompt({
    cwd: process.cwd(),
    platform: process.platform,
    shell: process.env.SHELL || process.env.ComSpec || 'bash',
  });
  const system = skillInstruction
    ? `${basePrompt}\n\n## Skill Instructions\n\n${skillInstruction}`
    : basePrompt;

  for (let step = 0; step < maxSteps; step++) {
    yield { _tag: 'Step', step: step + 1, max: maxSteps };

    const tools: ToolDescription[] = toolRegistry.describeAll();

    const { stream: rawStream, response: respPromise } = llm.completeStream({
      messages, system, tools, maxSteps: 1,
    });

    for await (const chunk of rawStream) {
      yield { _tag: 'LlmChunk', text: chunk };
    }

    const llmResult = await respPromise;
    if (!llmResult.ok) {
      yield { _tag: 'Error', error: llmResult.error };
      return Result.err(llmResult.error);
    }

    const resp = llmResult.value;
    const toolCalls = resp.toolCalls;
    const assistantMsg: Message = { role: 'assistant', content: resp.content };
    if (toolCalls && toolCalls.length > 0) {
      (assistantMsg as any).tool_calls = toolCalls;
    }
    messages.push(assistantMsg);
    yield { _tag: 'Assistant', content: resp.content, toolCalls };

    if (!toolCalls || toolCalls.length === 0) {
      yield { _tag: 'Done', content: resp.content };
      return Result.ok(resp.content);
    }

    // Separate safe & destructive tools: safe tools run in parallel, Bash runs serially
    const safeTools: ToolCall[] = [];
    const bashTools: ToolCall[] = [];

    for (const tc of toolCalls) {
      if (tc.name === 'execute_command' || tc.name === 'Bash') {
        bashTools.push(tc);
      } else {
        safeTools.push(tc);
      }
    }

    // Safe tools — parallel
    const safeResults = await Effect.runPromise(
      Effect.forEach(safeTools, (tc) => execTool(executor, tc, sessionId), { concurrency: 'unbounded' }),
    );

    for (const r of safeResults) {
      if (r.type === 'denied') {
        yield { _tag: 'ToolDenied', name: r.name, reason: r.reason };
      } else {
        yield { _tag: 'ToolResult', id: r.id, name: r.name, output: r.output, ok: r.type === 'ok' };
      }
    }

    // Bash tools — serial (avoid race conditions)
    const bashResults: ToolResultUnion[] = [];
    for (const tc of bashTools) {
      const r = await Effect.runPromise(execTool(executor, tc, sessionId));
      bashResults.push(r);
      if (r.type === 'denied') {
        yield { _tag: 'ToolDenied', name: r.name, reason: r.reason };
      } else {
        yield { _tag: 'ToolResult', id: r.id, name: r.name, output: r.output, ok: r.type === 'ok' };
      }
    }

    // Feed results back to LLM — denied tools still get a message so the LLM knows
    const allResults = [...safeResults, ...bashResults];
    for (const r of allResults) {
      if (messages.find(m => (m as any).tool_call_id === r.id)) continue;
      const content = r.type === 'denied'
        ? `[Denied] Tool "${r.name}" was denied: ${(r as any).reason as string}`
        : (r as any).output ?? '';
      messages.push({ role: 'tool', content, tool_call_id: r.id, tool_name: r.name });
    }
  }

  yield { _tag: 'Error', error: AgentError.maxStepsReached(maxSteps) };
  return Result.err(AgentError.maxStepsReached(maxSteps));
}
