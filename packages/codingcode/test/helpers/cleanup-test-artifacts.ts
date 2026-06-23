import { afterAll } from 'vitest';
import { existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TEST_DIR_PATTERN = /^c-users-10116-appdata-local-temp-codingcode-test-/;

/**
 * Registers a process-wide afterAll that wipes any leftover test artifacts
 * from the real `~/.codingcode/projects/` directory. Safety net for tests
 * that don't use `useTempProjectBase`.
 *
 * Pattern matches encoded tmp cwd paths (e.g. on Windows:
 * `c-users-10116-appdata-local-temp-codingcode-test-submit-plan-flow`).
 */
export function cleanupTestArtifacts(): void {
  afterAll(() => {
    const plansBase = join(homedir(), '.codingcode', 'projects');
    if (!existsSync(plansBase)) return;
    try {
      for (const entry of readdirSync(plansBase)) {
        if (TEST_DIR_PATTERN.test(entry)) {
          rmSync(join(plansBase, entry), { recursive: true, force: true });
        }
      }
    } catch {
      // best-effort cleanup
    }
  });
}
