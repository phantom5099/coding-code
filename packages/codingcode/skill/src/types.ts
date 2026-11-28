import type { ConfigSource } from '@codingcode/util';

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly skillPath: string;
  readonly source: ConfigSource;
}

export interface SkillRef {
  readonly name: string;
  readonly path: string;
}
