import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { normalizePath, projectDataDir } from '@codingcode/util';
import type { GitExecResult, GitFileChange } from './types.js';
import { toGitPath } from './utils.js';

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

const IGNORE_RULES = [
  'node_modules/',
  '.venv/',
  'venv/',
  'dist/',
  'build/',
  '*.log',
  '.env',
  '.env.*',
  '*.tmp',
  '*.temp',
  '.DS_Store',
  'Thumbs.db',
];

const SIZE_CAP_MB = 1_024;

export class ShadowGit {
  readonly gitDir: string;
  readonly projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = normalizePath(projectPath);
    this.gitDir = join(projectDataDir(this.projectPath), 'checkpoint', 'repo.git');
  }

  init(): void {
    const isNew = !existsSync(join(this.gitDir, 'HEAD'));
    if (isNew) {
      mkdirSync(this.gitDir, { recursive: true });
      spawnSync('git', ['init', '--bare', this.gitDir], {
        env: process.env,
        cwd: this.projectPath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const infoDir = join(this.gitDir, 'info');
      mkdirSync(infoDir, { recursive: true });
      writeFileSync(join(infoDir, 'exclude'), IGNORE_RULES.join('\n') + '\n', 'utf8');
    }
    this.run('config', 'core.hooksPath', NULL_DEVICE);
    this.run('config', 'core.bare', 'false');
    this.run('config', 'core.quotepath', 'false');
    this.run('config', 'gc.auto', '0');
    this.run('config', 'user.name', 'agent-checkpoint');
    this.run('config', 'user.email', 'checkpoint@agent.local');
  }

  stageAll(): void {
    const result = this.run('add', '-A');
    if (result.status !== 0) {
      throw new Error(`ShadowGit add failed: ${result.stderr}`);
    }
  }

  commit(message: string): string {
    this.init();
    this.stageAll();
    const result = this.run('commit', '--allow-empty', '-m', message);
    if (result.status !== 0) throw new Error(`ShadowGit commit failed: ${result.stderr}`);
    const match = result.stdout.trim().match(/^\[[\w-]+ ([a-f0-9]+)\]/);
    if (match?.[1]) return match[1];
    const head = this.run('rev-parse', 'HEAD');
    return head.stdout.trim() || '';
  }

  checkoutFiles(commit: string, files: readonly string[]): void {
    if (files.length === 0) return;
    const pathspecs = files.map((f) => toGitPath(this.projectPath, f));
    const result = this.run('restore', '--source', commit, '--', ...pathspecs);
    if (result.status !== 0) {
      throw new Error(`ShadowGit restore failed: ${result.stderr}`);
    }
  }

  /** git diff --name-status between two commits. */
  diffFiles(range: { readonly from: string; readonly to: string }): GitFileChange[] {
    const result = this.run('diff', '--name-status', range.from, range.to);
    if (result.status !== 0 || !result.stdout.trim()) return [];
    return this.parseNameStatus(result.stdout);
  }

  diffNameStatusAgainstWorkspace(baseline: string): GitFileChange[] {
    const result = this.run('diff', '--name-status', baseline);
    return result.status === 0 ? this.parseNameStatus(result.stdout) : [];
  }

  findCommitByMessage(pattern: string): string | null {
    const result = this.run('log', '--all', '--grep', pattern, '--format=%H', '-n', '1');
    const hash = result.stdout.trim();
    return hash || null;
  }

  git(...args: string[]): GitExecResult {
    return this.run(...args);
  }

  isTooLargeForSnapshot(): boolean {
    const hasHead = this.run('rev-parse', '--verify', 'HEAD').status === 0;
    const result = hasHead
      ? this.run('diff', '--cached', '--name-only', 'HEAD')
      : this.run('ls-files');
    const files = result.stdout.trim().split('\n').filter(Boolean);
    let totalBytes = 0;
    for (const f of files) {
      try {
        totalBytes += statSync(join(this.projectPath, f)).size;
      } catch {
        continue;
      }
      if (totalBytes > SIZE_CAP_MB * 1024 * 1024) return true;
    }
    return false;
  }

  private parseNameStatus(stdout: string): GitFileChange[] {
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [status = '', ...rest] = line.split('\t');
        return { status, file: rest.join('\t') };
      });
  }

  private run(...args: string[]): GitExecResult {
    const result = spawnSync(
      'git',
      ['--git-dir', this.gitDir, '--work-tree', this.projectPath, ...args],
      {
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: NULL_DEVICE,
          GIT_CONFIG_SYSTEM: NULL_DEVICE,
        },
        cwd: this.projectPath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
    };
  }
}
