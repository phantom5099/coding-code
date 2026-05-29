import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, statSync, writeFileSync, unlinkSync, openSync, closeSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { normalizePath, encodeProjectPath } from '../core/path.js';

export { normalizePath } from '../core/path.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

const IGNORE_RULES = [
  'node_modules/', '.venv/', 'venv/', 'dist/', 'build/',
  '*.log', '.env', '.env.*', '*.tmp', '*.temp', '.DS_Store', 'Thumbs.db',
];

const FILE_COUNT_CAP = 10_000;
const SIZE_CAP_MB = 1_024;

export class ShadowGit {
  readonly gitDir: string;
  readonly projectPath: string;
  private readonly lockPath: string;
  private lockFd: number | null = null;

  constructor(projectPath: string) {
    // Normalize path so same dir always produces same encoding (forward slash + lowercase drive)
    this.projectPath = normalizePath(projectPath);
    const encoded = encodeProjectPath(this.projectPath);
    this.gitDir = join(PROJECT_BASE, encoded, 'checkpoint', 'repo.git');
    this.lockPath = join(PROJECT_BASE, encoded, 'checkpoint', 'repo.lock');
  }

  init(): void {
    if (existsSync(join(this.gitDir, 'HEAD'))) return;
    mkdirSync(this.gitDir, { recursive: true });
    // init --bare requires the path as a positional argument, not as --git-dir
    spawnSync('git', ['init', '--bare', this.gitDir], {
      env: process.env, cwd: this.projectPath, encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.run('config', 'core.hooksPath', NULL_DEVICE);
    this.run('config', 'core.bare', 'false');
    this.run('config', 'gc.auto', '0');
    this.run('config', 'user.name', 'agent-checkpoint');
    this.run('config', 'user.email', 'checkpoint@agent.local');
    const infoDir = join(this.gitDir, 'info');
    mkdirSync(infoDir, { recursive: true });
    writeFileSync(join(infoDir, 'exclude'), IGNORE_RULES.join('\n') + '\n', 'utf8');
  }

  commit(message: string): string {
    this.init();
    // Add all tracked & untracked files (respecting exclude rules)
    const lsResult = this.run('ls-files', '-m', '-o', '--exclude-standard');
    const files = lsResult.stdout.trim().split('\n').filter(Boolean);
    if (files.length > 0) {
      this.run('add', ...files);
    }
    const result = this.run('commit', '--allow-empty', '-m', message);
    if (result.status !== 0) throw new Error(`ShadowGit commit failed: ${result.stderr}`);
    const match = result.stdout.trim().match(/^\[[\w-]+ ([a-f0-9]+)\]/);
    if (match?.[1]) return match[1];
    // fallback: try rev-parse HEAD
    const head = this.run('rev-parse', 'HEAD');
    return head.stdout.trim() || '';
  }

  checkoutFiles(commit: string, files: string[]): void {
    if (files.length === 0) return;
    // restore --source handles both existing files (restores content) and
    // non-existing files at baseline (deletes them) — unlike checkout which errors
    this.run('restore', '--source', commit, '--', ...files);
  }

  /** git diff --name-status between two commits. Returns [{ status, file }] */
  diffFiles(commitA: string, commitB: string): Array<{ status: string; file: string }> {
    const result = this.run('diff', '--name-status', commitA, commitB);
    if (result.status !== 0 || !result.stdout.trim()) return [];
    return result.stdout.trim().split('\n')
      .filter(Boolean)
      .map((line) => {
        const [status = '', ...rest] = line.split('\t');
        return { status, file: rest.join('\t') };
      });
  }

  findCommitByMessage(pattern: string): string | null {
    const result = this.run('log', '--all', '--grep', pattern, '--format=%H');
    const hash = result.stdout.trim();
    return hash || null;
  }

  /** Show file content from a commit. Returns null if file doesn't exist in that commit. */
  showFile(commit: string, file: string): string | null {
    const result = this.run('show', `${commit}:${file}`);
    if (result.status !== 0) return null;
    return result.stdout;
  }

  /** Public git command wrapper — used by CheckpointService for diagnostics. */
  git(...args: string[]): { stdout: string; stderr: string; status: number | null } {
    return this.run(...args);
  }

  shouldFallback(): boolean {
    const result = this.run('ls-files', '-m', '-o', '--exclude-standard');
    const files = result.stdout.trim().split('\n').filter(Boolean);
    if (files.length > FILE_COUNT_CAP) return true;
    let totalBytes = 0;
    for (const f of files) {
      try {
        totalBytes += statSync(join(this.projectPath, f)).size;
      } catch { continue; }
      if (totalBytes > SIZE_CAP_MB * 1024 * 1024) return true;
    }
    return false;
  }

  // ---- Lock ----
  lock(): void {
    for (let i = 0; ; i++) {
      try {
        this.lockFd = openSync(this.lockPath, 'wx');
        closeSync(this.lockFd);
        return;
      } catch {
        if (i > 500) throw new Error('ShadowGit lock timeout');
      }
    }
  }

  unlock(): void {
    if (this.lockFd !== null) {
      try { unlinkSync(this.lockPath); } catch { /* ignore */ }
      this.lockFd = null;
    }
  }

  // ---- Private ----
  private run(...args: string[]): { stdout: string; stderr: string; status: number | null } {
    const result = spawnSync('git', ['--git-dir', this.gitDir, '--work-tree', this.projectPath, ...args], {
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: NULL_DEVICE,
        GIT_CONFIG_SYSTEM: NULL_DEVICE,
      },
      cwd: this.projectPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
    };
  }
}
