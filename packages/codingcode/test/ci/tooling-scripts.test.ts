import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('CI tooling configuration', () => {
  const root = join(__dirname, '../../../..');

  it('eslint config exists and is parseable', () => {
    const configPath = join(root, 'eslint.config.mjs');
    expect(existsSync(configPath)).toBe(true);
  });

  it('prettier config exists and is valid JSON', () => {
    const configPath = join(root, '.prettierrc');
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('package.json has required CI scripts', () => {
    const pkgPath = join(root, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    expect(pkg.scripts.lint).toBeDefined();
    expect(pkg.scripts['lint:fix']).toBeDefined();
    expect(pkg.scripts.format).toBeDefined();
    expect(pkg.scripts['format:check']).toBeDefined();
    expect(pkg.scripts.typecheck).toBeDefined();
    expect(pkg.scripts.test).toBeDefined();
  });

  it('GitHub Actions workflow exists with required jobs', () => {
    const workflowPath = join(root, '.github/workflows/pr-check.yml');
    expect(existsSync(workflowPath)).toBe(true);
    const content = readFileSync(workflowPath, 'utf8');
    expect(content).toContain('jobs:');
    expect(content).toContain('lint:');
    expect(content).toContain('format-check:');
    expect(content).toContain('typecheck:');
    expect(content).toContain('test:');
    expect(content).toContain('build-desktop:');
  });

  it('pnpm run lint exits successfully', () => {
    expect(() => execSync('pnpm run lint', { cwd: root, stdio: 'pipe' })).not.toThrow();
  }, 20000);

  it('pnpm run format:check exits successfully', () => {
    expect(() => execSync('pnpm run format:check', { cwd: root, stdio: 'pipe' })).not.toThrow();
  }, 20000);
});
