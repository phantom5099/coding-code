import { openSync, closeSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { normalizePath, encodeProjectPath, getProjectBaseDir } from '../core/path.js';

export class ProjectLock {
  private readonly lockPath: string;
  private locked = false;

  constructor(projectPath: string) {
    const encoded = encodeProjectPath(normalizePath(projectPath));
    this.lockPath = join(getProjectBaseDir(), encoded, 'checkpoint', 'repo.lock');
  }

  lock(): void {
    mkdirSync(dirname(this.lockPath), { recursive: true });
    for (let i = 0; ; i++) {
      try {
        const fd = openSync(this.lockPath, 'wx');
        closeSync(fd);
        this.locked = true;
        return;
      } catch {
        if (i > 500) throw new Error('ProjectLock timeout');
      }
    }
  }

  unlock(): void {
    if (this.locked) {
      try {
        unlinkSync(this.lockPath);
      } catch {
        /* ignore */
      }
      this.locked = false;
    }
  }
}
