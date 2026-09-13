import { Context } from 'effect';

export interface RulesShape {
  getAllRules(projectPath?: string): string;
  evictProjectRules(projectPath: string): void;
}

export class RulesService extends Context.Tag('Rules')<RulesService, RulesShape>() {}
