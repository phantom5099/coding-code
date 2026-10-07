import { Context } from 'effect';
import type { Effect } from 'effect';
import type { Skill } from './types.js';

export interface SkillShape {
  getAll(projectPath: string): Effect.Effect<Skill[]>;
  readContent(skillPath: string): Effect.Effect<string>;
}

export class SkillService extends Context.Tag('Skill')<SkillService, SkillShape>() {}
