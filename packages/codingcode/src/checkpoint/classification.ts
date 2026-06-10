import { resolve } from 'path';
import { normalizePath } from '../core/path.js';
import type { ShadowGit } from './shadow-git.js';
import type { Ledger } from './ledger.js';
import { commitMsg } from './commit-naming.js';

export function classifyDiff(
  projectPath: string,
  sessionId: string,
  turnId: number,
  sg: ShadowGit,
  ledgerInstance: Ledger
): { agentModified: string[]; unknownSource: string[] } | null {
  const baseline = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'baseline'));
  const final = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'final'));
  if (!baseline || !final) return null;

  const allChanges = sg.diffFiles(baseline, final);
  const rawAllFiles = allChanges.map((c) => normalizePath(resolve(projectPath, c.file)));
  const allFiles = [...new Set(rawAllFiles)];
  const agentFiles = new Set(
    ledgerInstance.getAgentFiles(turnId, sessionId).map((p) => normalizePath(p).toLowerCase())
  );

  return {
    agentModified: allFiles.filter((f) => agentFiles.has(f.toLowerCase())),
    unknownSource: allFiles.filter((f) => !agentFiles.has(f.toLowerCase())),
  };
}

export function parseDiffStats(diffText: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) insertions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { insertions, deletions };
}
