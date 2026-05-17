import { Effect } from 'effect';
import { ContextService } from './context/context.js';
import { AgentService } from './agent/agent.js';
import { SessionService, type SessionStoreState } from './session/store.js';

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

    yield* ctx.addUser(input);
    yield* session.recordUser(state, input);

    return agent.runStream(llm, executor);
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
    }

    return history;
  });

export const compact = (state: SessionStoreState) =>
  Effect.gen(function* () {
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const agent = yield* AgentService;

    const result = yield* agent.compactContext();
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
