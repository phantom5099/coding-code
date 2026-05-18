import { Effect } from 'effect';
import { ContextService } from './context/context.js';
import { AgentService } from './agent/agent.js';
import { SessionService, type SessionStoreState } from './session/store.js';
import { SkillService } from './skills/index.js';
import type { AgentEvent } from './bus/types.js';
import type { AgentError } from './core/error.js';
import { Result } from './core/result.js';

export const sendMessage = (
  state: SessionStoreState,
  input: string,
  llm: any,
  executor: any,
  _hooks: any,
) =>
  Effect.gen(function* () {
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const agent = yield* AgentService;
    const skill = yield* SkillService;
    const sid = state.sessionId;

    yield* agent.init({ role: state.sessionMeta?.role ?? 'coder' });

    const [matchedSkill, actualInput] = yield* skill.extractSkill(input);
    if (matchedSkill) {
      yield* agent.init({
        role: state.sessionMeta?.role ?? 'coder',
        systemPrompt: matchedSkill.instruction,
      });
    }

    yield* ctx.addUser(sid, actualInput);
    yield* session.recordUser(state, actualInput);

    const messages = yield* ctx.build(sid);
    const raw = agent.runStream(messages, llm, executor);
    return wrapStream(raw, ctx, session, state, sid);
  });

export const resumeSession = (
  state: SessionStoreState,
  _cwd: string,
) =>
  Effect.gen(function* () {
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const agent = yield* AgentService;
    const sid = state.sessionId;

    const history = yield* session.readHistory(state);
    yield* ctx.clear(sid);
    const msgs = yield* session.readMessages(state);
    yield* ctx.setMessages(sid, msgs);

    const meta = history.find((e) => e.type === 'session_meta') as { role?: string } | undefined;
    if (meta?.role) {
      yield* agent.switchRole(meta.role);
    } else {
      yield* agent.init({ role: 'coder' });
    }

    return history;
  });

export const compact = (state: SessionStoreState) =>
  Effect.gen(function* () {
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const sid = state.sessionId;

    const result = yield* ctx.compress(sid);
    if (result.didCompress) {
      yield* session.recordCompactBoundary(
        state,
        result.summary ?? '',
        result.replacedRange ?? [0, 0],
        result.messageCount ?? 0,
      );
    }
    return result;
  });

async function* wrapStream(
  source: AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown>,
  ctx: ContextService,
  session: SessionService,
  state: SessionStoreState,
  sid: string,
): AsyncGenerator<string, Result<string, AgentError>, unknown> {
  let assistantUuid: string | undefined;
  const model = state.sessionMeta?.model ?? 'unknown';

  while (true) {
    const next = await source.next();
    if (next.done) return next.value;

    const event = next.value;
    switch (event._tag) {
      case 'LlmChunk':
        yield event.text;
        break;

      case 'Step':
        break;

      case 'Assistant': {
        await Effect.runPromise(ctx.addAssistant(sid, event.content, event.toolCalls));
        const ev = await Effect.runPromise(
          session.recordAssistant(state, event.content, event.toolCalls as any, model),
        );
        assistantUuid = (ev as any).uuid;
        break;
      }

      case 'ToolStart':
        yield `\n[Using: ${event.name}]\n`;
        break;

      case 'ToolResult': {
        await Effect.runPromise(ctx.addToolResult(sid, event.id, event.output, event.name));
        if (assistantUuid) {
          await Effect.runPromise(
            session.recordToolResult(state, assistantUuid, event.name, event.id, event.output),
          );
        }
        break;
      }

      case 'Error':
      case 'Done':
        break;
    }
  }
}
