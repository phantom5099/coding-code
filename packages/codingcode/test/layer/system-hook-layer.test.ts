import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HookService } from '../../src/hooks/registry.js';
import { SystemHookLayer } from '../../src/layer.js';
import { computePaths } from '../../src/core/paths.js';

describe('SystemHookLayer', () => {
  it('builds without "Service not found: HookService" (regression: was a self-referential Layer.effect)', async () => {
    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      return typeof hooks.register;
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(SystemHookLayer) as any));
    expect(result).toBe('function');
  });

  it('registers the remaining plan-mode system hooks', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'codingcode-syshook-'));
    try {
      const paths = computePaths(cwd, 's');
      mkdirSync(paths.transcriptPath.replace(/\.jsonl$/, ''), { recursive: true });
      const idx = {
        sessionId: 's',
        projectPath: paths.projectPath,
        cwd: paths.cwd,
        model: 'test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
        title: 's',
        currentTurnId: 0,
        usage: undefined,
        mode: 'plan',
        permissionMode: 'default',
      };
      writeFileSync(paths.indexPath, JSON.stringify(idx, null, 2), 'utf8');

      const program = Effect.gen(function* () {
        const hooks = yield* HookService;

        // (1) planModeGateHook denies write tools in plan mode
        const denied = yield* hooks.emitDecision('tool.approval.pre', {
          toolName: 'write_file',
          args: { path: '/x' },
          sessionId: 's',
          projectPath: cwd,
        });
        expect(denied).not.toBeNull();
        expect(denied?.decision).toBe('deny');
        expect(denied?.reason).toMatch(/plan mode/i);

        // (2) planModeGateHook lets submit_plan through
        const allowed = yield* hooks.emitDecision('tool.approval.pre', {
          toolName: 'submit_plan',
          args: { plan_content: '## plan' },
          sessionId: 's',
          projectPath: cwd,
        });
        expect(allowed).toBeNull();

        return true;
      });

      await Effect.runPromise(program.pipe(Effect.provide(SystemHookLayer) as any));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
