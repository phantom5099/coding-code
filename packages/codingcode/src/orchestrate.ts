import { Effect } from 'effect';
import { ContextService } from './context/context.js';
import { AgentService } from './agent/agent.js';
import { SessionService, type SessionStoreState } from './session/store.js';
import { SkillService } from './skills/index.js';
import { withRecording } from './orchestrate/recording.js';

// AgentService, ToolExecutorService, HookService all resolved via AppLayer — no need to pass them in
export const sendMessage = (
  state: SessionStoreState,
  input: string,
  llm: any,
) =>
  Effect.gen(function* () {
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const agent = yield* AgentService;
    const skill = yield* SkillService;
    const sid = state.sessionId;

    const [matchedSkill, actualInput] = yield* skill.extractSkill(input);

    yield* ctx.addUser(sid, actualInput);
    yield* session.recordUser(state, actualInput);

    const messages = yield* ctx.build(sid);
    const raw = agent.runStream(messages, llm, sid, matchedSkill?.instruction);
    return withRecording(raw, ctx, session, state, sid);
  });

export const resumeSession = (
  state: SessionStoreState,
  _cwd: string,
) =>
  Effect.gen(function* () {
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const sid = state.sessionId;

    const history = yield* session.readHistory(state);
    yield* ctx.clear(sid);
    const msgs = yield* session.readMessages(state);
    yield* ctx.setMessages(sid, msgs);

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
