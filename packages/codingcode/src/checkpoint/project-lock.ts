import { openSync, closeSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getGlobalDir, normalizePath, encodeProjectPath } from '../core/path.js';
import { PROJECTS_DIRNAME } from '../contracts/paths.js';

export class ProjectLock {
  private readonly lockPath: string;
  private locked = false;

  constructor(projectPath: string) {
    const encoded = encodeProjectPath(normalizePath(projectPath));
    this.lockPath = join(getGlobalDir(), PROJECTS_DIRNAME, encoded, 'checkpoint', 'repo.lock');
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
