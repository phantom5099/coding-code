import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { AgentError } from '../core/error.js';
import { getGlobalDir } from '../core/path.js';

/**
 * 请求入口层的工作区解析。
 *
 * 调用方给的 cwd 是「用户输入」，它的合法性与回落策略属于入口职责，
 * 因此放在 server 层，而不是下沉到具体领域模块。
 */

/** 空 / `'global'` 视为「无工作区」的请求。 */
export function isGlobalCwd(raw: string | undefined): boolean {
  return !raw || raw === '' || raw === 'global';
}

/** 无工作区的请求共用的临时工作目录：`<~/.codingcode>/temp`。 */
export function tempCwd(): string {
  return join(getGlobalDir(), 'temp');
}

/**
 * 解析请求携带的 cwd。
 * 缺省 → 共享 temp；显式给出 → 绝对化。用于「以 cwd 为键查询」的端点，
 * 不校验目录是否还在（项目目录被删后，其历史会话仍应可列出）。
 */
export function resolveCwd(raw?: string): string {
  return raw ? resolve(raw) : tempCwd();
}

/**
 * 解析要「建立 / 进入工作区」的端点（建会话、发消息）的 cwd。
 * 缺省 → 共享 temp；显式给出但磁盘上不存在 → CONFIG_INVALID（400）。
 */
export function resolveWorkspaceCwd(raw?: string): string {
  if (isGlobalCwd(raw)) return tempCwd();
  const abs = resolve(raw!);
  if (!existsSync(abs)) {
    throw new AgentError('CONFIG_INVALID', `Workspace directory does not exist: ${abs}`);
  }
  return abs;
}
