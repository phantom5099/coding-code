import { Effect } from 'effect';
import { ContextService } from './context/context.js';
import { AgentService } from './agent/agent.js';
import { SessionService, type SessionStoreState } from './session/store.js';
import { SkillService } from './skills/index.js';
import type { ReActEvent } from './agent/types.js';
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

    yield* agent.init({ role: state.sessionMeta?.role ?? 'coder' });

    // Check for @skill-name prefix activation
    const [matchedSkill, actualInput] = yield* skill.extractSkill(input);

    // If a skill was activated via @prefix, inject its instruction
    if (matchedSkill) {
      yield* agent.init({
        role: state.sessionMeta?.role ?? 'coder',
        systemPrompt: matchedSkill.instruction,
      });
    }

    yield* ctx.addUser(actualInput);
    yield* session.recordUser(state, actualInput);

    const messages = yield* ctx.build();
    const raw = agent.runStream(messages, llm, executor);
    return wrapStream(raw, ctx, session, state);
  });

export const resumeSession = (
  state: SessionStoreState,
  _cwd: string,
) =>
  Effect.gen(function* () {
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const agent = yield* AgentService;

    const history = yield* session.readHistory(state);
    yield* ctx.clear();
    const msgs = yield* session.readMessages(state);
    yield* ctx.setMessages(msgs);

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

    const result = yield* ctx.compress();
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
  source: AsyncGenerator<ReActEvent, Result<string, AgentError>, unknown>,
  ctx: ContextService,
  session: SessionService,
  state: SessionStoreState,
): AsyncGenerator<string, Result<string, AgentError>, unknown> {
  let assistantUuid: string | undefined;
  const model = state.sessionMeta?.model ?? 'unknown';

  while (true) {
    const next = await source.next();
    if (next.done) {
      return next.value;
    }

    const event = next.value;
    switch (event.type) {
      case 'text':
        yield event.text;
        break;

      case 'step':
        break;

      case 'assistant': {
        await Effect.runPromise(ctx.addAssistant(event.content, event.toolCalls));
        const ev = await Effect.runPromise(
          session.recordAssistant(state, event.content, event.toolCalls as any, model),
        );
        assistantUuid = (ev as any).uuid;
        break;
      }

      case 'toolStart':
        yield `\n[Using: ${event.name}]\n`;
        break;

      case 'toolResult': {
        await Effect.runPromise(ctx.addToolResult(event.id, event.output, event.name));
        if (assistantUuid) {
          await Effect.runPromise(
            session.recordToolResult(state, assistantUuid, event.name, event.id, event.output),
          );
        }
        break;
      }

      case 'error':
        break;
    }
  }
}
