import { spawn } from 'child_process';
import type { HookBasePayload, HookCommandOutput, UserHookConfig } from './types.js';

/** hook 子进程的超时上限 */
const HOOK_TIMEOUT_MS = 30000;

export type HookRunConfig = Pick<UserHookConfig, 'command' | 'args' | 'env'>;

interface HookRunRequest {
  readonly config: HookRunConfig;
  readonly payload: HookBasePayload;
  readonly stdout: 'ignore' | 'capture';
}

function runHook(req: HookRunRequest): Promise<{ code: number | null; stdout: string }> {
  const { config, payload, stdout: stdoutMode } = req;
  const captureStdout = stdoutMode === 'capture';
  return new Promise((resolve, reject) => {
    const child = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: captureStdout ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'ignore', 'pipe'],
    });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Hook timed out'));
    }, HOOK_TIMEOUT_MS);
    if (captureStdout) {
      child.stdout!.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
    }
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.stdin!.write(JSON.stringify(payload));
    child.stdin!.end();
  });
}

/** 观察者 hook：只求跑完，不看输出；失败向调用方抛出 */
export async function executeHookCommand(
  config: HookRunConfig,
  payload: HookBasePayload
): Promise<void> {
  await runHook({ config, payload, stdout: 'ignore' });
}

/** 决策 hook：读 stdout 的 JSON；超时 / 非零退出 / 解析失败或非对象一律降级为 null */
export async function executeDecisionHookCommand(
  config: HookRunConfig,
  payload: HookBasePayload
): Promise<HookCommandOutput | null> {
  const result = await runHook({ config, payload, stdout: 'capture' }).catch(() => null);
  if (!result || result.code !== 0) return null;
  try {
    const parsed: unknown = JSON.parse(result.stdout.trim());
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as HookCommandOutput)
      : null;
  } catch {
    return null;
  }
}
