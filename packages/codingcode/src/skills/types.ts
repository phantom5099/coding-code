export interface Skill {
  readonly name: string;
  readonly description: string;
  /** Absolute path to the skill's SKILL.md file. */
  readonly skillPath: string;
}

export interface SkillServiceApi {
  readonly getAll: import('effect').Effect.Effect<readonly Skill[]>;
  readonly findByName: (name: string) => import('effect').Effect.Effect<Skill | undefined>;
  readonly select: (query: string) => import('effect').Effect.Effect<Skill | undefined>;
  readonly selectImplicit: (
    query: string,
    matcher: (
      skills: readonly Skill[],
      query: string
    ) => import('effect').Effect.Effect<string | undefined>
  ) => import('effect').Effect.Effect<Skill | undefined>;
}
