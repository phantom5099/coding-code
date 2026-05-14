import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

// ── Paths ──

/** 全局规则文件路径 */
function getGlobalRulesPath(): string {
  return path.join(os.homedir(), ".coding-agent", "rules.md");
}

/** 项目规则文件路径 */
function getProjectRulesPath(): string {
  return path.join(process.cwd(), ".coderules");
}

// ── Read ──

/** 读取全局规则，不存在返回空字符串 */
export function getGlobalRules(): string {
  try {
    return fs.readFileSync(getGlobalRulesPath(), "utf-8").trim();
  } catch {
    return "";
  }
}

/** 读取项目规则，不存在返回空字符串 */
export function getProjectRules(): string {
  try {
    return fs.readFileSync(getProjectRulesPath(), "utf-8").trim();
  } catch {
    return "";
  }
}

/** 获取所有规则（全局 + 项目），已格式化好 */
export function getAllRules(): string {
  const parts: string[] = [];
  const global = getGlobalRules();
  const project = getProjectRules();

  if (global) {
    parts.push(`## Global Rules\n\n${global}`);
  }
  if (project) {
    parts.push(`## Project-level Rules\n\n${project}`);
  }

  return parts.join("\n\n");
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
export function clearProjectRules(): void {
  try {
    fs.unlinkSync(getProjectRulesPath());
  } catch {
    // file may not exist
  }
}

// ── Edit ──

/** 在编辑器中打开文件（非阻塞），返回是否成功启动 */
export function editInEditor(filePath: string): boolean {
  const editor = process.env.EDITOR
    || process.env.VISUAL
    || (process.platform === "win32" ? "notepad" : "vim");

  try {
    // Windows 上使用 start 命令启动 GUI 编辑器，不会阻塞终端
    if (process.platform === "win32") {
      spawn("cmd.exe", ["/c", "start", "", editor, filePath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } else {
      // Unix 上 spawn 子进程并脱离父进程
      spawn(editor, [filePath], {
        detached: true,
        stdio: "ignore",
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
    fs.writeFileSync(p, "", "utf-8");
  }
  return editInEditor(p);
}

/** 编辑项目规则 */
export function editProjectRules(): boolean {
  const p = getProjectRulesPath();
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, "", "utf-8");
  }
  return editInEditor(p);
}
