export interface Skill {
  readonly name: string;
  readonly description: string;
  /** Absolute path to the skill's SKILL.md file. */
  readonly skillPath: string;
}
