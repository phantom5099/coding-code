import { EventEmitter } from 'events';

export interface FakeProcOpts {
  /** 退出码，默认 0 */
  code?: number | null;
  /** 写到 stdout 的内容（决策 hook 读它） */
  stdout?: string;
  /** 触发 'error' 事件 */
  error?: Error;
  /** 延迟多少毫秒才 close（测超时/顺序用） */
  delayMs?: number;
}

export interface SpawnRecord {
  command: string;
  args: string[];
  payload: unknown;
}

export type FakeProc = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: (chunk: string) => void; end: () => void };
  kill: () => void;
};

/** 每次 spawn 的记录，按发生顺序（emit 是顺序执行，故顺序即 handler 顺序） */
export const spawnRecords: SpawnRecord[] = [];

const responses = new Map<string, FakeProcOpts>();

/** 按 command 配置该次 spawn 的行为；未配置则 code 0 + 空 stdout */
export function whenCommand(command: string, opts: FakeProcOpts): void {
  responses.set(command, opts);
}

export function resetFakeSpawn(): void {
  spawnRecords.length = 0;
  responses.clear();
}

/** 替代 child_process.spawn 的桩 */
export function fakeSpawn(command: string, args: string[] = []): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {
    /* 超时路径：不再触发 close */
  };
  let payload: unknown;
  proc.stdin = {
    write: (chunk: string) => {
      payload = JSON.parse(chunk);
    },
    end: () => {
      /* noop */
    },
  };

  const opts = responses.get(command) ?? {};
  const finish = () => {
    spawnRecords.push({ command, args, payload });
    if (opts.error) {
      proc.emit('error', opts.error);
      return;
    }
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    proc.emit('close', opts.code ?? 0);
  };
  if (opts.delayMs) setTimeout(finish, opts.delayMs);
  else queueMicrotask(finish);

  return proc;
}
