import { Context } from 'effect';
import type { Effect } from 'effect';
import type { Skill } from './types.js';

export interface SkillShape {
  getAll(projectPath: string): Effect.Effect<Skill[]>;
  findByName(projectPath: string, name: string): Effect.Effect<Skill | undefined>;
  select(projectPath: string, query: string): Effect.Effect<Skill | undefined>;
  selectImplicit(projectPath: string, query: string, matcher: (all: readonly Skill[], q: string) => Effect.Effect<string | undefined>): Effect.Effect<Skill | undefined>;
  extractSkill(projectPath: string, query: string): Effect.Effect<[Skill | undefined, string]>;
  evictProject(projectPath: string): Effect.Effect<void>;
}

export class SkillService extends Context.Tag('Skill')<SkillService, SkillShape>() {}
