import { spawn } from 'child_process';

/** hook 子进程的超时上限 */
const HOOK_TIMEOUT_MS = 30000;

export interface HookRunConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * 跑一次 hook 子进程，把 payload 以 JSON 写到它的 stdin。
 * 超时或 spawn 失败一律 reject，由调用方决定怎么降级。
 */
function runHook(
  config: HookRunConfig,
  payload: Record<string, unknown>,
  captureStdout: boolean
): Promise<{ code: number | null; stdout: string }> {
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
  payload: Record<string, unknown>
): Promise<void> {
  await runHook(config, payload, false);
}

/** 决策 hook：读 stdout 的 JSON；超时 / 非零退出 / 解析失败一律降级为 null */
export async function executeDecisionHookCommand(
  config: HookRunConfig,
  payload: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const result = await runHook(config, payload, true).catch(() => null);
  if (!result || result.code !== 0) return null;
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }
}
