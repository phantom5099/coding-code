import { Effect } from 'effect';
import { AgentService } from '../agent/agent.js';
import { SessionService } from '../session/store.js';
import { SkillService } from '../skills/index.js';
import { HookService } from '../hooks/registry.js';
import { McpService } from '../mcp/index.js';
import { CheckpointService } from '../checkpoint/checkpoint-service.js';

export const sendMessage = (
  sessionId: string | undefined,
  input: string,
  cwd: string,
  llm: any,
) =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const agent = yield* AgentService;
    const skill = yield* SkillService;
    const hooks = yield* HookService;
    const mcp = yield* McpService;
    const checkpoint = yield* CheckpointService;

    yield* hooks.reloadUserHooks(cwd);
    yield* mcp.syncConnections(cwd);

    const state = yield* session.create(cwd, 'unknown', '0.1.0', sessionId);
    const sid = state.sessionId;

    const turnId = session.incrementTurn(state);
    const [matchedSkill, actualInput] = yield* skill.extractSkill(input);

    yield* session.recordUser(state, actualInput);

    const turnTitle = actualInput.trim().slice(0, 5) || '(empty)';
    checkpoint.snapshotBaseline(state.cwd, sid, turnId, turnTitle);

    const stream = agent.runStream({ state, llm, skillInstruction: matchedSkill?.instruction });

    return { stream, sessionId: sid };
  });
