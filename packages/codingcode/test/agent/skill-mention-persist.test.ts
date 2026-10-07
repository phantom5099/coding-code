import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionLayer } from '../../src/session/session.js';
import { SessionService } from '../../src/session/port.js';
import { SkillLayer } from '../../src/skills/skills.js';
import { SkillService } from '../../src/skills/port.js';
import { normalizePath } from '../../src/core/path.js';
import { computePaths } from '../../src/session/paths.js';
import { readHistory } from '../../src/session/file-ops.js';
import type { UserEvent } from '../../src/session/types.js';
import { runAgentTurn, llmStream, pText, pEnd } from '../helpers/agent-harness.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

const SKILL_NAME = 'release-notes';
const SKILL_BODY = `---
name: ${SKILL_NAME}
description: "Draft release notes"

## Steps
1. Collect merged PRs
`;

/** 取 agent 侧实际使用的权威 skillPath（与前端从列表拿到的路径同源）。 */
async function canonicalSkillPath(cwd: string): Promise<string> {
  return Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const svc = yield* SkillService;
        const all = yield* svc.getAll(normalizePath(cwd));
        return all.find((s) => s.name === SKILL_NAME)!.skillPath;
      }),
      SkillLayer
    )
  );
}

describe('agent runTurn with an explicit @ skill', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(base.dir, randomUUID());
    const skillDir = join(projectDir, '.codingcode', 'skills', SKILL_NAME);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), SKILL_BODY);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  /** 真实 Session + 真实 Skill、mock LLM，跑一轮带 @ skill 的回合。 */
  async function runTurnWithSkill() {
    const input = `please @${SKILL_NAME} before shipping`;
    const skillPath = await canonicalSkillPath(projectDir);

    const { sessionId } = await runAgentTurn(
      {
        llm: {
          completeStream: () => llmStream(pText('ok'), pEnd()),
          modelInfo: { maxTokens: 1000 },
        },
        sessionLayer: SessionLayer,
        skillLayer: SkillLayer,
      },
      {
        cwd: projectDir,
        input,
        activeProfile: 'build',
        permissionMode: 'askBeforeExec',
        skills: [{ name: SKILL_NAME, path: skillPath }],
      }
    );

    return { sessionId, input, skillPath };
  }

  it('persists the untouched user text and the skill block as two events of one turn', async () => {
    const { sessionId, input, skillPath } = await runTurnWithSkill();

    const persisted = readHistory(computePaths(projectDir, sessionId).transcriptPath);
    const userEvents = persisted.filter((e): e is UserEvent => e.type === 'user');

    expect(userEvents).toHaveLength(2);
    expect(userEvents[0]!.content).toBe(input);
    expect(userEvents[0]!.source).toBe('user');

    const block = userEvents[1]!;
    expect(block.source).toBe('system');
    expect(block.turnId).toBe(userEvents[0]!.turnId);
    expect(block.content).toContain(SKILL_NAME);
    expect(block.content).toContain(skillPath);
    expect(block.content).toContain('Collect merged PRs');
  });

  it('does not surface the skill block in the UI history', async () => {
    const { sessionId, input } = await runTurnWithSkill();

    const turns = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.readUITurns(sessionId, projectDir);
        }),
        SessionLayer
      )
    );

    const userMessages = turns
      .flatMap((t) => t.items)
      .flatMap((i) => (i.type === 'message' && i.role === 'user' ? [i.content] : []));

    expect(userMessages).toEqual([input]);
  });
});
