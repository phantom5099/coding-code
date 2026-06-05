import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';

// ── Paths ──

/** 全局规则文件路径 */
function getGlobalRulesPath(): string {
  return path.join(os.homedir(), '.codingcode', 'rules.md');
}

/** 项目规则文件路径 */
function getProjectRulesPath(projectPath?: string): string {
  return path.join(projectPath ?? process.cwd(), 'AGENTS.md');
}

// ── Read (cached internally, use getAllRules as public API) ──

let _globalRules: string | null = null;

function getGlobalRules(): string {
  if (_globalRules !== null) return _globalRules;
  try {
    _globalRules = fs.readFileSync(getGlobalRulesPath(), 'utf-8').trim();
  } catch {
    _globalRules = '';
  }
  return _globalRules;
}

const _projectRulesCache = new Map<string, string>();

function getProjectRules(projectPath?: string): string {
  const key = projectPath ?? process.cwd();
  if (_projectRulesCache.has(key)) return _projectRulesCache.get(key)!;
  let content = '';
  try {
    content = fs.readFileSync(getProjectRulesPath(projectPath), 'utf-8').trim();
  } catch {
    // not found
  }
  _projectRulesCache.set(key, content);
  return content;
}

const _allRulesCache = new Map<string, string>();

/** 获取所有规则（全局 + 项目），已格式化好 */
export function getAllRules(projectPath?: string): string {
  const key = projectPath ?? process.cwd();
  const cached = _allRulesCache.get(key);
  if (cached !== undefined) return cached;
  const result = buildAllRules(projectPath);
  _allRulesCache.set(key, result);
  return result;
}

function buildAllRules(projectPath?: string): string {
  const parts: string[] = [];
  const global = getGlobalRules();
  const project = getProjectRules(projectPath);
  if (global) parts.push(`## Global Rules\n\n${global}`);
  if (project) parts.push(`## Project-level Rules\n\n${project}`);
  return parts.join('\n\n');
}

export function evictProjectRules(projectPath: string): void {
  _projectRulesCache.delete(projectPath);
  _allRulesCache.delete(projectPath);
}

// ── Clear ──

/** 清除全局规则 */
export function clearGlobalRules(): void {
  try {
    fs.unlinkSync(getGlobalRulesPath());
  } catch {
    // file may not exist
  }
}

/** 清除项目规则 */
export function clearProjectRules(projectPath?: string): void {
  try {
    fs.unlinkSync(getProjectRulesPath(projectPath));
  } catch {
    // file may not exist
  }
}

// ── Edit ──

/** 在编辑器中打开文件（非阻塞），返回是否成功启动 */
export function editInEditor(filePath: string): boolean {
  const editor =
    process.env.EDITOR || process.env.VISUAL || (process.platform === 'win32' ? 'notepad' : 'vim');

  try {
    // Windows 上使用 start 命令启动 GUI 编辑器，不会阻塞终端
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', editor, filePath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } else {
      // Unix 上 spawn 子进程并脱离父进程
      spawn(editor, [filePath], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

/** 编辑全局规则 */
export function editGlobalRules(): boolean {
  const p = getGlobalRulesPath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, '', 'utf-8');
  }
  return editInEditor(p);
}

/** 编辑项目规则 */
export function editProjectRules(projectPath?: string): boolean {
  const p = getProjectRulesPath(projectPath);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, '', 'utf-8');
  }
  return editInEditor(p);
}
