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

    // Execute all tools — safe tools in parallel, Bash tools serially
    const allResults = await Effect.runPromise(
      executor.executeBatch(toolCalls, sessionId),
    );

    for (const r of allResults) {
      if (r.type === 'denied') {
        yield { _tag: 'ToolDenied', name: r.name, reason: r.reason };
      } else {
        yield { _tag: 'ToolResult', id: r.id, name: r.name, output: r.output, ok: r.type === 'ok' };
      }
    }

    // Feed results back to LLM — denied tools still get a message so the LLM knows
    for (const r of allResults) {
      if (messages.find(m => (m as any).tool_call_id === r.id)) continue;
      const content = r.type === 'denied'
        ? `[Denied] Tool "${r.name}" was denied: ${r.reason}`
        : r.output ?? '';
      messages.push({ role: 'tool', content, tool_call_id: r.id, tool_name: r.name });
    }
  }

  yield { _tag: 'Error', error: AgentError.maxStepsReached(maxSteps) };
  return Result.err(AgentError.maxStepsReached(maxSteps));
}
