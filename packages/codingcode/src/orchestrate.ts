import { Effect } from 'effect';
import { ContextService } from './context/context.js';
import { AgentService } from './agent/agent.js';
import { SessionService } from './session/store.js';
import { SkillService } from './skills/index.js';
import { withRecording } from './recording.js';

export const sendMessage = (
  sessionId: string | undefined,
  input: string,
  cwd: string,
  llm: any,
) =>
  Effect.gen(function* () {
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const agent = yield* AgentService;
    const skill = yield* SkillService;

    const state = yield* session.create(cwd, 'unknown', '0.1.0', sessionId);
    const sid = state.sessionId;

    const [matchedSkill, actualInput] = yield* skill.extractSkill(input);

    yield* ctx.addUser(sid, actualInput);
    yield* session.recordUser(state, actualInput);

    const messages = yield* ctx.build(sid);
    const raw = agent.runStream(messages, llm, sid, matchedSkill?.instruction);
    return { stream: withRecording(raw, ctx, session, state, sid), sessionId: sid };
  });

export const resumeSession = (
  sessionId: string,
  cwd: string,
) =>
  Effect.gen(function* () {
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const state = yield* session.create(cwd, 'unknown', '0.1.0', sessionId);
    const sid = state.sessionId;

    const history = yield* session.readHistory(state);
    yield* ctx.clear(sid);
    const msgs = yield* session.readMessages(state);
    yield* ctx.setMessages(sid, msgs);

    return history;
  });

export const compact = (sessionId: string, cwd: string) =>
  Effect.gen(function* () {
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const state = yield* session.create(cwd, 'unknown', '0.1.0', sessionId);
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
