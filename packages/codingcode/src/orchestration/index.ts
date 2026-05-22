import { Effect } from 'effect';
import { ContextService } from '../context/context.js';
import { AgentService } from '../agent/agent.js';
import { SessionService } from '../session/store.js';
import { SkillService } from '../skills/index.js';
import { CheckpointService } from '../checkpoint/checkpoint-service.js';
import { turnIdBySession, projectPathBySession } from '../checkpoint/bootstrap.js';
import { recordAgentEvents } from './record-agent-events.js';

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
    const checkpoint = yield* CheckpointService;

    const state = yield* session.create(cwd, 'unknown', '0.1.0', sessionId);
    const sid = state.sessionId;

    // Increment turn and update the session mappings for Ledger hooks
    const turnId = session.incrementTurn(state);
    turnIdBySession.set(sid, turnId);
    projectPathBySession.set(sid, state.cwd);

    const [matchedSkill, actualInput] = yield* skill.extractSkill(input);

    yield* ctx.addUser(sid, actualInput);
    yield* session.recordUser(state, actualInput);

    // Snapshot filesystem + include turn title for checkpoint UI
    const projectPath = state.cwd;
    const turnTitle = actualInput.trim().slice(0, 5) || '(empty)';
    checkpoint.snapshotBaseline(projectPath, sid, turnId, turnTitle);

    const messages = yield* ctx.build(sid);
    const raw = agent.runStream(messages, llm, sid, matchedSkill?.instruction);
    const stream = recordAgentEvents(raw, ctx, session, state, sid);

    // Wrap the stream to snapshot and compress after agent finishes
    const wrapped = async function* () {
      try {
        for await (const event of stream) {
          yield event;
        }
      } finally {
        checkpoint.snapshotFinal(projectPath, sid, turnId);
      }
      // Compression check after stream fully consumed and snapshot saved
      await Effect.runPromise(ctx.appendTurnEnd(sid, llm));
    }();

    return { stream: wrapped, sessionId: sid };
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

export const compact = (sessionId: string, cwd: string, llm: any = null) =>
  Effect.gen(function* () {
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const state = yield* session.create(cwd, 'unknown', '0.1.0', sessionId);
    const sid = state.sessionId;

    // Delegate to Compressor via context service; no compact_boundary written.
    // The llm is passed through so L5 can call it (or its configured
    // compactionModel) for the five-section summary.
    return yield* ctx.compress(sid, llm);
  });
