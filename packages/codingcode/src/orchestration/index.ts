import { Effect } from 'effect';
import { ContextService } from '../context/context.js';
import { AgentService, type AgentEvent } from '../agent/agent.js';
import { SessionService } from '../session/store.js';
import { SkillService } from '../skills/index.js';
import { CheckpointService } from '../checkpoint/checkpoint-service.js';
import { run } from '../context/compressor/index.js';
import { buildMessagesForQuery } from '../context/projection/build.js';
import { getContextConfig } from '../context/config.js';
import type { Message } from '../core/types.js';
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

    let messages = yield* ctx.build(sid);
    const config = getContextConfig();
    const maxRetries = config.reactiveCompactMaxRetries;

    const stream = withReactiveCompact(messages, llm, agent, { session, ctx, checkpoint }, { state, sid, turnId, projectPath, llm, matchedSkill, config, maxRetries });

    return { stream, sessionId: sid };
  });

async function* withReactiveCompact(
  initialMessages: Message[],
  llm: any,
  agent: any,
  deps: { session: any; ctx: any; checkpoint: any },
  params: {
    state: any; sid: string; turnId: number; projectPath: string; llm: any;
    matchedSkill: { instruction?: string } | undefined;
    config: any; maxRetries: number;
  },
): AsyncGenerator<AgentEvent, void, unknown> {
  let messages = initialMessages;
  const { state, sid, turnId, projectPath, matchedSkill, config, maxRetries } = params;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = agent.runStream(messages, llm, sid, turnId, projectPath, matchedSkill?.instruction);
    const recorded = recordTurn(raw, deps, { state, sid, turnId, projectPath, llm });

    for await (const event of recorded) {
      if (event._tag === 'Error' && 'code' in event.error && event.error.code === 'CONTEXT_OVERFLOW' && attempt < maxRetries) {
        const aggressiveConfig = { ...config, L5KeepRecentTurns: config.reactiveCompactKeepTurns };
        const compressResult = await run(sid, 0, null, aggressiveConfig);
        yield { _tag: 'ReactiveCompact', attempt: attempt + 1, released: compressResult.released };
        messages = buildMessagesForQuery(sid, config).map((e) => e.message);
        break;
      }
      yield event;
    }
    return;
  }
}
