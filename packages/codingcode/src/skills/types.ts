export interface Skill {
  readonly name: string;
  readonly description: string;
  /** Markdown body of SKILL.md (injected into system prompt) */
  readonly instruction: string;
  readonly references: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
  }>;
  readonly scripts: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
  }>;
  readonly assets: ReadonlyArray<{
    readonly path: string;
    readonly mimeType: string;
    readonly size: number;
  }>;
  /** Extra fields from YAML front matter (license, cursor-globs, etc.) */
  readonly metadata: Record<string, unknown>;
}

export interface SkillServiceApi {
  readonly getAll: import('effect').Effect.Effect<readonly Skill[]>;
  readonly findByName: (name: string) => import('effect').Effect.Effect<Skill | undefined>;
  readonly select: (query: string) => import('effect').Effect.Effect<Skill | undefined>;
  readonly selectImplicit: (
    query: string,
    matcher: (skills: readonly Skill[], query: string) => import('effect').Effect.Effect<string | undefined>,
  ) => import('effect').Effect.Effect<Skill | undefined>;
}
