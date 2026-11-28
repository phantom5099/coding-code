import { Context } from 'effect';
import type { Effect } from 'effect';

export interface RulesShape {
  getAllRules(projectPath?: string): Effect.Effect<string>;
  evictProjectRules(projectPath: string): Effect.Effect<void>;
}

export class RulesService extends Context.Tag('Rules')<RulesService, RulesShape>() {}
