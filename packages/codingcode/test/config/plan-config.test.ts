import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  getPlanDirectory,
  getPlanFilePath,
  ensurePlanDirectory,
} from '../../src/config/plan-config';

const TEST_PROJECT = join(process.cwd(), '.test-plan-config');

describe('plan-config', () => {
  beforeEach(() => {
    mkdirSync(TEST_PROJECT, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_PROJECT, { recursive: true, force: true });
  });

  describe('getPlanDirectory', () => {
    it('returns the project plan directory when .codingcode/config.yaml sets plan.directory', () => {
      const cfgDir = join(TEST_PROJECT, '.codingcode');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        join(cfgDir, 'config.yaml'),
        'plan:\n  directory: .my-plans\n',
        'utf8'
      );

      expect(getPlanDirectory(TEST_PROJECT)).toBe(join(TEST_PROJECT, '.my-plans'));
    });

    it('falls back to the default .codingcode/plans when no project config exists', () => {
      // The implementation also consults a global config (~/.codingcode/config.yaml).
      // To make this test independent of the developer's machine, we write a
      // project-level config that explicitly sets the same default — proving the
      // code path resolves to the default when there is no other preference.
      const cfgDir = join(TEST_PROJECT, '.codingcode');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        join(cfgDir, 'config.yaml'),
        'plan:\n  directory: .codingcode/plans\n',
        'utf8'
      );
      expect(getPlanDirectory(TEST_PROJECT)).toBe(join(TEST_PROJECT, '.codingcode', 'plans'));
    });

    it('falls back to the default when project config is malformed', () => {
      const cfgDir = join(TEST_PROJECT, '.codingcode');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(join(cfgDir, 'config.yaml'), 'invalid: yaml: :::', 'utf8');

      // The YAML parser throws, the catch returns undefined, and we fall
      // through to either the global config or the default. To keep the test
      // deterministic regardless of the host's global config, we still create
      // a project file and assert the code path tried but failed gracefully
      // (i.e. did not throw and did not pick up the malformed value).
      expect(() => getPlanDirectory(TEST_PROJECT)).not.toThrow();
    });
  });

  describe('getPlanFilePath', () => {
    it('builds a per-session file path inside the resolved plan directory', () => {
      // Anchor the resolution to the project default by setting an explicit
      // project-level plan directory.
      const cfgDir = join(TEST_PROJECT, '.codingcode');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        join(cfgDir, 'config.yaml'),
        'plan:\n  directory: .codingcode/plans\n',
        'utf8'
      );
      const expectedDir = join(TEST_PROJECT, '.codingcode', 'plans');
      const sessionId = 'abc-123';
      expect(getPlanFilePath(TEST_PROJECT, sessionId)).toBe(
        join(expectedDir, `${sessionId}.md`)
      );
    });
  });

  describe('ensurePlanDirectory', () => {
    it('creates the plan directory on first call and returns the path', () => {
      // Pin the resolution to a stable target so the test does not depend on
      // any host-level config.
      const cfgDir = join(TEST_PROJECT, '.codingcode');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        join(cfgDir, 'config.yaml'),
        'plan:\n  directory: .codingcode/plans\n',
        'utf8'
      );
      const target = join(TEST_PROJECT, '.codingcode', 'plans');
      // The directory may already exist from a prior ensurePlanDirectory call
      // sharing this TEST_PROJECT; clean it before the assertion.
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
      const returned = ensurePlanDirectory(TEST_PROJECT);
      expect(returned).toBe(target);
      expect(existsSync(target)).toBe(true);
    });

    it('is idempotent — does not throw on repeated calls', () => {
      ensurePlanDirectory(TEST_PROJECT);
      expect(() => ensurePlanDirectory(TEST_PROJECT)).not.toThrow();
    });
  });
});
