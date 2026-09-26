import { homedir } from 'os';
import { join } from 'path';

export const CODINGCODE_DIRNAME = '.codingcode';

export function getGlobalDir(): string {
  return join(homedir(), CODINGCODE_DIRNAME);
}
