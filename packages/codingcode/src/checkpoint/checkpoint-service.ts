import { Effect } from 'effect';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { ShadowGit } from './shadow-git.js';
import { Ledger } from './ledger.js';
import { bootstrapCheckpoint } from './bootstrap.js';
import { HookService } from '../hooks/registry.js';
import { createHash } from 'crypto';

interface ForwardEntry {
  turnId: number;
  sessionId: string;
  safetyCommit: string;
  selectedFiles: string[];
  timestamp: string;
}

function shortSid(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
}

function forwardPath(gitDir: string, sessionId: string): string {
  const dir = dirname(gitDir);
  return join(dir, `forward-${shortSid(sessionId)}.json`);
}

export class CheckpointService extends Effect.Service<CheckpointService>()('Checkpoint', {
  effect: Effect.gen(function* () {
    // Register Ledger hook observers at service creation time
    const hooks = yield* HookService;
    bootstrapCheckpoint(hooks, process.cwd());

    let _sg: ShadowGit | null = null;
    let _ledger: Ledger | null = null;

    function ensure(projectPath: string): ShadowGit {
      if (!_sg || _sg.projectPath !== projectPath) {
        _sg = new ShadowGit(projectPath);
        _sg.init();
      }
      return _sg;
    }

    function ledger(sg: ShadowGit): Ledger {
      if (!_ledger) _ledger = new Ledger(sg.gitDir);
      return _ledger;
    }

    function commitMsg(sessionId: string, turnId: number, suffix: string): string {
      return `turn-${shortSid(sessionId)}-${turnId}-${suffix}`;
    }

    return {
      snapshotBaseline: (projectPath: string, sessionId: string, turnId: number): void => {
        const sg = ensure(projectPath);
        sg.lock();
        try { sg.commit(commitMsg(sessionId, turnId, 'baseline')); }
        finally { sg.unlock(); }
      },

      snapshotFinal: (projectPath: string, sessionId: string, turnId: number): void => {
        const sg = ensure(projectPath);
        sg.lock();
        try { sg.commit(commitMsg(sessionId, turnId, 'final')); }
        finally { sg.unlock(); }
      },

      classifyChanges: (
        projectPath: string, sessionId: string, turnId: number,
      ): { agentModified: string[]; unknownSource: string[] } | null => {
        const sg = ensure(projectPath);
        const baseline = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'baseline'));
        const final = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'final'));
        if (!baseline || !final) return null;

        const allChanges = sg.diffFiles(baseline, final);
        const allFiles = [...new Set(allChanges.map((c) => c.file))];
        const agentFiles = new Set(ledger(sg).getAgentFiles(turnId, sessionId));

        return {
          agentModified: allFiles.filter((f) => agentFiles.has(f)),
          unknownSource: allFiles.filter((f) => !agentFiles.has(f)),
        };
      },

      getCompletedTurns: (projectPath: string, sessionId: string): number[] => {
        const sg = ensure(projectPath);
        const ids: number[] = [];
        const prefix = commitMsg(sessionId, 0, '').slice(0, -1); // remove the 0
        for (let i = 1; i <= 10000; i++) {
          const b = sg.findCommitByMessage(`${prefix}${i}-baseline`);
          const f = sg.findCommitByMessage(`${prefix}${i}-final`);
          if (b && f) ids.push(i);
          if (!b && !f) break;
        }
        return ids;
      },

      revertFiles: (projectPath: string, sessionId: string, turnId: number, selectedFiles: string[]): void => {
        if (selectedFiles.length === 0) return;
        const sg = ensure(projectPath);
        const baseline = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'baseline'));
        if (!baseline) throw new Error(`No baseline commit found for turn ${turnId}`);

        sg.lock();
        try {
          const safetyCommit = sg.commit(commitMsg(sessionId, turnId, 'revert-safety'));
          sg.checkoutFiles(baseline, selectedFiles);

          const entry: ForwardEntry = { turnId, sessionId, safetyCommit, selectedFiles, timestamp: new Date().toISOString() };
          writeFileSync(forwardPath(sg.gitDir, sessionId), JSON.stringify([entry]), 'utf8');
        } finally {
          sg.unlock();
        }
      },

      forward: (projectPath: string, sessionId: string): number | null => {
        const sg = ensure(projectPath);
        const fwdPath = forwardPath(sg.gitDir, sessionId);
        if (!existsSync(fwdPath)) return null;

        try {
          const stack: ForwardEntry[] = JSON.parse(readFileSync(fwdPath, 'utf8'));
          const entry = stack.pop();
          if (!entry) { writeFileSync(fwdPath, '[]', 'utf8'); return null; }

          sg.lock();
          try {
            sg.checkoutFiles(entry.safetyCommit, entry.selectedFiles);
            writeFileSync(fwdPath, JSON.stringify(stack), 'utf8');
          } finally {
            sg.unlock();
          }
          return entry.turnId;
        } catch {
          return null;
        }
      },

      hasForwardStack: (projectPath: string, sessionId: string): boolean => {
        const sg = ensure(projectPath);
        const fwdPath = forwardPath(sg.gitDir, sessionId);
        if (!existsSync(fwdPath)) return false;
        try {
          const stack: ForwardEntry[] = JSON.parse(readFileSync(fwdPath, 'utf8'));
          return stack.length > 0;
        } catch { return false; }
      },
    };
  }),
}) {}
