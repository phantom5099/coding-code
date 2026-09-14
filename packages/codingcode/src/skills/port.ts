import { Context } from 'effect';
import type { Effect } from 'effect';
import type { Skill } from '../contracts/skill.js';

export interface SkillShape {
  getAll(projectPath: string): Effect.Effect<Skill[]>;
  extractSkill(projectPath: string, query: string): Effect.Effect<[Skill | undefined, string]>;
}

export class SkillService extends Context.Tag('Skill')<SkillService, SkillShape>() {}
