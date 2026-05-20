import { Effect } from 'effect';
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';

export interface SandboxConfig {
  allowedDomains?: string[];
  deniedDomains?: string[];
  allowReadPaths?: string[];
  allowWritePaths?: string[];
  denyReadPaths?: string[];
  denyWritePaths?: string[];
  allowUnixSockets?: string[];
  defaultTimeoutMs?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecuteOptions {
  command: string;
  timeoutMs?: number;
}

interface SrtApi {
  initialize: (config: Record<string, unknown>) => Promise<void>;
  isAvailable: () => boolean;
  wrapWithSandbox: (command: string) => Promise<string>;
  cleanup: () => Promise<void>;
}

let srtModule: SrtApi | null = null;

async function loadSrt(): Promise<SrtApi | null> {
  if (srtModule) return srtModule;
  const req = createRequire(import.meta.url);
  try {
    const mod = req('@anthropic-ai/sandbox-runtime') as {
      SandboxManager?: {
        initialize: (cfg: Record<string, unknown>) => Promise<void>;
        isAvailable: () => boolean;
        wrapWithSandbox: (cmd: string) => Promise<string>;
        cleanup: () => Promise<void>;
      };
    };
    const mgr = mod?.SandboxManager;
    if (!mgr || typeof mgr.isAvailable !== 'function') return null;
    srtModule = {
      initialize: (cfg) => mgr.initialize(cfg),
      isAvailable: () => mgr.isAvailable(),
      wrapWithSandbox: (cmd) => mgr.wrapWithSandbox(cmd),
      cleanup: () => mgr.cleanup(),
    };
    return srtModule;
  } catch {
    return null;
  }
}

function spawnWithTimeout(
  command: string,
  timeoutMs: number,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    exec(command, { timeout: timeoutMs }, (err: unknown, stdout: string, stderr: string) => {
      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: err ? ((err as NodeJS.ErrnoException).code as unknown as number) ?? 1 : 0,
      });
    });
  });
}

function dieOnError<T>(eff: Effect.Effect<T, unknown, never>): Effect.Effect<T, never, never> {
  return eff.pipe(Effect.catchAll((e) => Effect.die(e)));
}

export class SandboxService extends Effect.Service<SandboxService>()('Sandbox', {
  effect: Effect.gen(function* () {
    let available = false;

    return {
      initialize: (cfg: SandboxConfig): Effect.Effect<void> =>
        Effect.gen(function* () {
          const srt = yield* dieOnError(Effect.tryPromise(() => loadSrt()));
          if (!srt || !srt.isAvailable()) {
            yield* Effect.logWarning(
              'Sandbox runtime not available (unsupported platform or not installed). ' +
              'Falling back to application-level approval only.',
            );
            available = false;
            return;
          }

          yield* dieOnError(Effect.tryPromise(() =>
            srt.initialize({
              network: {
                allowedDomains: cfg.allowedDomains ?? [],
                deniedDomains: cfg.deniedDomains ?? [],
                allowLocalBinding: false,
                allowUnixSockets: cfg.allowUnixSockets ?? [],
              },
              filesystem: {
                denyRead: cfg.denyReadPaths ?? [],
                allowRead: cfg.allowReadPaths ?? [],
                allowWrite: cfg.allowWritePaths ?? [],
                denyWrite: cfg.denyWritePaths ?? [],
              },
            }),
          ));
          available = true;
        }),

      wrapCommand: (command: string): Effect.Effect<string> =>
        Effect.gen(function* () {
          if (!available) return command;
          const srt = yield* dieOnError(Effect.tryPromise(() => loadSrt()));
          if (!srt) return command;
          return yield* dieOnError(Effect.tryPromise(() => srt.wrapWithSandbox(command)));
        }),

      execute: (opts: ExecuteOptions): Effect.Effect<ExecResult> =>
        Effect.gen(function* () {
          const cmd = opts.command;
          const timeout = opts.timeoutMs ?? 60000;

          if (!available) {
            return yield* dieOnError(Effect.tryPromise(() =>
              spawnWithTimeout(cmd, timeout),
            ));
          }
          const srt = yield* dieOnError(Effect.tryPromise(() => loadSrt()));
          const wrapped = srt
            ? yield* dieOnError(Effect.tryPromise(() => srt.wrapWithSandbox(cmd)))
            : cmd;
          return yield* dieOnError(Effect.tryPromise(() =>
            spawnWithTimeout(wrapped, timeout),
          ));
        }),

      isAvailable: (): boolean => available,

      cleanup: (): Effect.Effect<void> =>
        Effect.gen(function* () {
          const srt = yield* dieOnError(Effect.tryPromise(() => loadSrt()));
          if (srt) {
            yield* dieOnError(Effect.tryPromise(() => srt.cleanup()));
          }
          available = false;
        }),
    };
  }),
}) {}
