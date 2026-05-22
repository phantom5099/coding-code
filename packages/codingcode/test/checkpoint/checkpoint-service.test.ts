import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir, homedir } from 'os';
import { randomUUID, createHash } from 'crypto';
import { Effect, Layer } from 'effect';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';
import { projectSlugFromPath } from '../../src/core/path.js';
import { HookService } from '../../src/hooks/registry.js';

describe('CheckpointService', () => {
  let projectPath: string;
  const testLayer = Layer.mergeAll(
    HookService.Default,
    CheckpointService.Default.pipe(Layer.provide(Layer.mergeAll(HookService.Default))),
  );

  beforeEach(() => {
    projectPath = join(tmpdir(), `cp-test-${randomUUID().slice(0, 8)}`);
    mkdirSync(projectPath, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(projectPath, { recursive: true, force: true }); } catch { /* ignore */ }
    const hash = projectSlugFromPath(projectPath);
    const shadowsDir = join(homedir(), '.codingcode', 'checkpoints');
    try { rmSync(join(shadowsDir, `${hash}.git`), { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(join(shadowsDir, `${hash}.lock`), { force: true }); } catch { /* ignore */ }
    // Clean forward files for known test session IDs
    for (const sid of ['s1', 's2', 's3', 's4']) {
      const shortHash = createHash('sha256').update(sid).digest('hex').slice(0, 8);
      try { rmSync(join(shadowsDir, `forward-${shortHash}.json`), { force: true }); } catch { /* ignore */ }
    }
  });

  function run<T>(fn: (svc: CheckpointService) => T): T {
    return Effect.runSync(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return fn(svc);
      }).pipe(Effect.provide(testLayer)),
    );
  }

  it('snapshotBaseline and snapshotFinal create commits', () => {
    run((svc) => {
      svc.snapshotBaseline(projectPath, 's1', 1);
      svc.snapshotFinal(projectPath, 's1', 1);
    });
  });

  it('classifyChanges returns null for non-existent turn', () => {
    run((svc) => {
      const result = svc.classifyChanges(projectPath, 's1', 999);
      expect(result).toBeNull();
    });
  });

  it('classifyChanges detects modified files', () => {
    run((svc) => {
      writeFileSync(join(projectPath, 'file.txt'), 'original', 'utf8');
      svc.snapshotBaseline(projectPath, 's1', 1);

      writeFileSync(join(projectPath, 'file.txt'), 'modified', 'utf8');
      svc.snapshotFinal(projectPath, 's1', 1);

      const result = svc.classifyChanges(projectPath, 's1', 1);
      expect(result).not.toBeNull();
      expect(result!.unknownSource).toContain(resolve(projectPath, 'file.txt'));
      expect(result!.agentModified).toEqual([]);
    });
  });

  it('revertFiles restores files to baseline', () => {
    run((svc) => {
      writeFileSync(join(projectPath, 'r.txt'), 'original', 'utf8');
      svc.snapshotBaseline(projectPath, 's2', 1);

      writeFileSync(join(projectPath, 'r.txt'), 'modified', 'utf8');
      svc.snapshotFinal(projectPath, 's2', 1);

      svc.revertFiles(projectPath, 's2', 1, ['r.txt']);
      expect(readFileSync(join(projectPath, 'r.txt'), 'utf8')).toBe('original');
    });
  });

  it('forward restores files to safety commit (redo)', () => {
    run((svc) => {
      writeFileSync(join(projectPath, 'f.txt'), 'original', 'utf8');
      svc.snapshotBaseline(projectPath, 's3', 1);

      writeFileSync(join(projectPath, 'f.txt'), 'modified', 'utf8');
      svc.snapshotFinal(projectPath, 's3', 1);

      // Revert to baseline
      svc.revertFiles(projectPath, 's3', 1, ['f.txt']);
      expect(readFileSync(join(projectPath, 'f.txt'), 'utf8')).toBe('original');

      // Forward (redo) back to the modified state
      const fwd = svc.forward(projectPath, 's3');
      expect(fwd).toBe(1);
      expect(readFileSync(join(projectPath, 'f.txt'), 'utf8')).toBe('modified');
    });
  });

  it('hasForwardStack checks forward availability', () => {
    run((svc) => {
      expect(svc.hasForwardStack(projectPath, 's4')).toBe(false);
      svc.snapshotBaseline(projectPath, 's4', 1);
      svc.snapshotFinal(projectPath, 's4', 1);
      expect(svc.hasForwardStack(projectPath, 's4')).toBe(false);
    });
  });

  it('classifyChanges tracks agentModified via hook ledger entries', async () => {
    const filePath = join(projectPath, 'agent-file.txt');
    writeFileSync(filePath, 'v1', 'utf8');

    await Effect.runPromise(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        const svc = yield* CheckpointService;

        svc.snapshotBaseline(projectPath, 'agent-test', 1);

        // Emit hooks as if write_file tool was called with an absolute path
        // Pass turnId and projectPath through the payload
        const absPath = resolve(filePath);
        yield* hooks.emit('tool.execute.before', {
          toolName: 'write_file',
          args: { path: absPath, content: 'v2' },
          sessionId: 'agent-test',
          turnId: 1,
          projectPath: projectPath,
        });

        writeFileSync(filePath, 'v2', 'utf8');

        yield* hooks.emit('tool.execute.after', {
          toolName: 'write_file',
          args: { path: absPath, content: 'v2' },
          result: 'ok',
          durationMs: 5,
          sessionId: 'agent-test',
          turnId: 1,
          projectPath: projectPath,
        });

        svc.snapshotFinal(projectPath, 'agent-test', 1);

        const result = svc.classifyChanges(projectPath, 'agent-test', 1);
        expect(result).not.toBeNull();
        expect(result!.agentModified).toContain(absPath);
        expect(result!.unknownSource).toEqual([]);
      }).pipe(Effect.provide(testLayer)),
    );
  });
});
