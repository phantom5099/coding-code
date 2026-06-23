import { homedir } from 'os';
import { join } from 'path';

export function normalizePath(p: string): string {
  let s = p.replaceAll('\\', '/');
  s = s.replace(/^\/([a-zA-Z])\//, (_, letter: string) => `${letter.toLowerCase()}:/`);
  s = s.replace(/^([A-Z]):/, (_, letter: string) => letter.toLowerCase() + ':');
  return s;
}

export function encodeProjectPath(p: string): string {
  const normalized = normalizePath(p);
  return normalized
    .replace(/[:/\\ ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}


let _projectBaseOverride: string | undefined;
let _projectPlansBaseOverride: string | undefined;

export function setProjectBaseDir(dir: string | undefined): void {
  _projectBaseOverride = dir;
}

export function setProjectPlansBaseDir(dir: string | undefined): void {
  _projectPlansBaseOverride = dir;
}

export function getProjectBaseDir(): string {
  return _projectBaseOverride ?? join(homedir(), '.codingcode', 'project');
}

export function getProjectPlansBaseDir(): string {
  return _projectPlansBaseOverride ?? join(homedir(), '.codingcode', 'projects');
}
