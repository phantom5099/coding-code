import { spawn } from 'child_process';

const _disabledHookNames = new Set<string>();

export function setHookRuntimeEnabled(name: string, enabled: boolean): void {
  if (enabled) _disabledHookNames.delete(name);
  else _disabledHookNames.add(name);
}

export function isHookRuntimeEnabled(name: string): boolean {
  return !_disabledHookNames.has(name);
}

export async function executeHookCommand(
  config: { command: string; args?: string[]; env?: Record<string, string> },
  payload: Record<string, unknown>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Hook timed out'));
    }, 30000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.stdin!.write(JSON.stringify(payload));
    child.stdin!.end();
  });
}

export async function executeDecisionHookCommand(
  config: { command: string; args?: string[]; env?: Record<string, string> },
  payload: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const child = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 30000);
    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve(null);
      }
    });
    child.on('error', () => {
      resolve(null);
    });
    child.stdin!.write(JSON.stringify(payload));
    child.stdin!.end();
  });
}
