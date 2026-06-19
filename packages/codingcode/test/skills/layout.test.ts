import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const REPO_ROOT = join(process.cwd(), 'packages', 'codingcode');
const SKILLS_SRC_DIR = join(REPO_ROOT, 'src', 'skills');
const SEARCH_ROOTS = [join(REPO_ROOT, 'src'), join(REPO_ROOT, 'test')];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function collectAllFiles(): string[] {
  return SEARCH_ROOTS.flatMap((root) => walk(root));
}

describe('skills module file layout', () => {
  it('exposes source.ts (not config.ts) as the on-disk layer', () => {
    expect(existsSync(join(SKILLS_SRC_DIR, 'source.ts'))).toBe(true);
    expect(existsSync(join(SKILLS_SRC_DIR, 'config.ts'))).toBe(false);
  });

  it('does not import the renamed-away "skills/config" path anywhere', () => {
    const stale: Array<{ file: string; line: number; text: string }> = [];
    for (const file of collectAllFiles()) {
      if (file.endsWith('layout.test.ts')) continue;
      const text = readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/['"][^'"]*skills[\\/]+config(\.js)?['"]/.test(line)) {
          stale.push({ file: relative(REPO_ROOT, file), line: i + 1, text: line.trim() });
        }
      });
    }
    expect(
      stale,
      `stale "skills/config" imports found:\n${JSON.stringify(stale, null, 2)}`
    ).toEqual([]);
  });
});
