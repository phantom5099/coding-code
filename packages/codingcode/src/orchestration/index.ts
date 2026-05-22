import { Effect } from 'effect';
import { ContextService } from '../context/context.js';
import { AgentService } from '../agent/agent.js';
import { SessionService } from '../session/store.js';
import { SkillService } from '../skills/index.js';
import { CheckpointService } from '../checkpoint/checkpoint-service.js';
import { recordTurn } from './turn-recorder.js';

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

    const turnId = session.incrementTurn(state);
    const [matchedSkill, actualInput] = yield* skill.extractSkill(input);

    yield* session.recordUser(state, actualInput);

    const projectPath = state.cwd;
    const turnTitle = actualInput.trim().slice(0, 5) || '(empty)';
    checkpoint.snapshotBaseline(projectPath, sid, turnId, turnTitle);

    const messages = yield* ctx.build(sid);
    const raw = agent.runStream(messages, llm, sid, turnId, projectPath, matchedSkill?.instruction);
    const stream = recordTurn(raw, { session, ctx, checkpoint },
      { state, sid, turnId, projectPath, llm });

    return { stream, sessionId: sid };
  });
