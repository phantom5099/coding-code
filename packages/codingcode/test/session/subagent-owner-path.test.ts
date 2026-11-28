import { describe, it, expect } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '@codingcode/session';
import { SessionLayer } from '@codingcode/session';
import {
  computePaths,
  projectSessionsDir,
  subagentOwnerOf,
  transcriptPathOf,
} from '@codingcode/session';
import { deleteSession } from '@codingcode/session/file-ops';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionLayer) as any));
}

const createOpts = {
  model: 'test-model',

  permissionMode: 'askBeforeExec' as const,
};

describe('subagentOwnerOf', () => {
  it('no parent: undefined (top-level session)', () => {
    expect(subagentOwnerOf({})).toBeUndefined();
    expect(subagentOwnerOf({ parentChain: ['x'] })).toBeUndefined();
  });

  it('chain absent: falls back to the direct parent (legacy layout)', () => {
    expect(subagentOwnerOf({ parentSessionId: 'parent' })).toBe('parent');
    expect(subagentOwnerOf({ parentSessionId: 'parent', parentChain: [] })).toBe('parent');
  });

  it('chain present: last element is the root session', () => {
    expect(subagentOwnerOf({ parentSessionId: 'a', parentChain: ['a', 'root'] })).toBe('root');
    expect(subagentOwnerOf({ parentSessionId: 'a', parentChain: ['root'] })).toBe('root');
  });
});

describe('transcriptPathOf with parentChain', () => {
  it('grandchild lands under the ROOT session subagents/, not the direct parent', () => {
    const cwd = '/tmp/test-owner-chain';
    const root = randomUUID();
    const mid = randomUUID();
    const leaf = randomUUID();

    const leafPath = transcriptPathOf({
      cwd,
      sessionId: leaf,
      parentSessionId: mid,
      parentChain: [mid, root],
    });
    const sessionsDir = projectSessionsDir(cwd);
    expect(leafPath).toBe(join(sessionsDir, root, 'subagents', `${leaf}.jsonl`));

    // 直接派生的子会话同样在根名下：全部子智能体共享一个 subagents/ 目录
    expect(
      transcriptPathOf({ cwd, sessionId: mid, parentSessionId: root, parentChain: [root] })
    ).toBe(join(sessionsDir, root, 'subagents', `${mid}.jsonl`));
  });

  it('chain absent keeps the legacy per-parent layout', () => {
    const cwd = '/tmp/test-owner-legacy';
    const parent = randomUUID();
    const child = randomUUID();
    expect(transcriptPathOf({ cwd, sessionId: child, parentSessionId: parent })).toBe(
      join(projectSessionsDir(cwd), parent, 'subagents', `${child}.jsonl`)
    );
  });

  it('top-level stays directly under sessions/', () => {
    const cwd = '/tmp/test-owner-top';
    const sid = randomUUID();
    expect(transcriptPathOf({ cwd, sessionId: sid })).toBe(
      join(projectSessionsDir(cwd), `${sid}.jsonl`)
    );
  });

  it('computePaths forwards the chain', () => {
    const cwd = '/tmp/test-owner-compute';
    const root = randomUUID();
    const mid = randomUUID();
    const leaf = randomUUID();
    const locator = { cwd, sessionId: leaf, parentSessionId: mid, parentChain: [mid, root] };
    expect(computePaths(locator).transcriptPath).toBe(transcriptPathOf(locator));
  });
});

describe('SessionService.create with parentChain', () => {
  it('grandchild transcript is written under the root session and the chain lands in meta', async () => {
    const cwd = '/tmp/test-create-chain-e2e';
    const root = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create({ cwd, ...createOpts });
      })
    );

    try {
      const mid = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create({
            cwd,
            ...createOpts,
            lineage: {
              parentSessionId: root.sessionId,
              parentChain: [root.sessionId],
            },
            subagent: { agentName: 'mid' },
          });
        })
      );
      expect(mid.parentChain).toEqual([root.sessionId]);

      const leaf = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create({
            cwd,
            ...createOpts,
            lineage: {
              parentSessionId: mid.sessionId,
              parentChain: [mid.sessionId, root.sessionId],
            },
            subagent: { agentName: 'leaf' },
          });
        })
      );

      try {
        const sessionsDir = projectSessionsDir(cwd);
        // 孙代与子代同目录：都挂在顶层主会话的 subagents/ 下
        expect(
          existsSync(join(sessionsDir, root.sessionId, 'subagents', `${mid.sessionId}.jsonl`))
        ).toBe(true);
        expect(
          existsSync(join(sessionsDir, root.sessionId, 'subagents', `${leaf.sessionId}.jsonl`))
        ).toBe(true);
        expect(existsSync(join(sessionsDir, mid.sessionId))).toBe(false);
        expect(leaf.parentChain).toEqual([mid.sessionId, root.sessionId]);

        // load 回读：链从会话头还原，定位不依赖调用方重述
        const reloaded = await run(
          Effect.gen(function* () {
            const svc = yield* SessionService;
            return yield* svc.load({
              cwd,
              sessionId: leaf.sessionId,
              parentSessionId: leaf.parentSessionId,
              parentChain: leaf.parentChain,
            });
          })
        );
        expect(reloaded.parentChain).toEqual([mid.sessionId, root.sessionId]);
        expect(reloaded.agentName).toBe('leaf');
      } finally {
        rmSync(join(base.dir, computePaths(leaf).projectPath), {
          recursive: true,
          force: true,
        });
      }
    } finally {
      rmSync(join(base.dir, computePaths(root).projectPath), {
        recursive: true,
        force: true,
      });
    }
  });

  it('top-level session meta carries no chain', async () => {
    const cwd = '/tmp/test-create-chain-top';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create({ cwd, ...createOpts });
      })
    );
    try {
      expect(state.parentChain).toBeUndefined();
      expect(existsSync(join(projectSessionsDir(cwd), `${state.sessionId}.jsonl`))).toBe(true);
    } finally {
      rmSync(join(base.dir, computePaths(state).projectPath), {
        recursive: true,
        force: true,
      });
    }
  });
});

describe('deleteSession', () => {
  it('deleting the top-level session removes the whole subtree under its subagents/', async () => {
    const cwd = '/tmp/test-delete-cascade';
    const root = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create({ cwd, ...createOpts });
      })
    );

    try {
      const mid = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create({
            cwd,
            ...createOpts,
            lineage: {
              parentSessionId: root.sessionId,
              parentChain: [root.sessionId],
            },
            subagent: { agentName: 'mid' },
          });
        })
      );
      const leaf = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create({
            cwd,
            ...createOpts,
            lineage: {
              parentSessionId: mid.sessionId,
              parentChain: [mid.sessionId, root.sessionId],
            },
            subagent: { agentName: 'leaf' },
          });
        })
      );

      const sessionsDir = projectSessionsDir(cwd);
      const subagentsDir = join(sessionsDir, root.sessionId, 'subagents');
      // 新布局：子代与孙代同在顶层主会话的 subagents/ 下
      expect(existsSync(join(subagentsDir, `${mid.sessionId}.jsonl`))).toBe(true);
      expect(existsSync(join(subagentsDir, `${leaf.sessionId}.jsonl`))).toBe(true);

      deleteSession({ cwd, sessionId: root.sessionId });

      expect(existsSync(join(sessionsDir, `${root.sessionId}.jsonl`))).toBe(false);
      // subagents/ 连同全部后代一并删除
      expect(existsSync(join(sessionsDir, root.sessionId))).toBe(false);
    } finally {
      rmSync(join(base.dir, computePaths(root).projectPath), {
        recursive: true,
        force: true,
      });
    }
  });
});
