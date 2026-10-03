import type { ProfileName } from './types.js';

export interface AvailableProfile {
  name: ProfileName;
  description: string;
}

export const AVAILABLE_PROFILES: AvailableProfile[] = [
  { name: 'plan', description: 'Planning agent' },
  { name: 'build', description: 'Build agent' },
];
