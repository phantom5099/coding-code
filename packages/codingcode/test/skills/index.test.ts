import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { Effect, Layer } from 'effect';
import { SkillService } from '../../src/skills/service.js';

const TEST_ROOT = process.cwd();
const TEST_CODINGCODE_DIR = join(TEST_ROOT, '.codingcode');

const SkillTestLayer = SkillService.Default;

const runWithSkill = <A>(f: (skill: SkillService) => Effect.Effect<A>): A =>
  Effect.runSync(
    Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* f(skill);
    }).pipe(Effect.provide(SkillTestLayer)) as any
  );

/** Run multiple operations against the same SkillService instance (shared cache). */
const runWithSharedSkill = <A>(
  ...ops: Array<(skill: SkillService) => Effect.Effect<unknown>>
): A[] =>
  Effect.runSync(
    Effect.gen(function* () {
      const skill = yield* SkillService;
      const results: A[] = [];
      for (const op of ops) {
        results.push((yield* op(skill)) as A);
      }
      return results;
    }).pipe(Effect.provide(SkillTestLayer)) as any
  );

describe('SkillService', () => {
  beforeEach(() => {
    if (existsSync(TEST_CODINGCODE_DIR))
      rmSync(TEST_CODINGCODE_DIR, { recursive: true, force: true });
    runWithSkill((s) => s.evictProject(TEST_ROOT));
    const dir = join(TEST_CODINGCODE_DIR, 'skills', 'test-basic');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---
name: test-basic
description: "A basic test skill for unit testing"
version: "1.0.0"
---
## Goal
Test the skill system.

## Steps
1. Do something
2. Verify result
`
    );
  });

  afterEach(() => {
    if (existsSync(TEST_CODINGCODE_DIR))
      rmSync(TEST_CODINGCODE_DIR, { recursive: true, force: true });
    runWithSkill((s) => s.evictProject(TEST_ROOT));
  });

  it('should load skills from .codingcode/skills/ on demand', () => {
    const skills = runWithSkill((s) => s.getAll(TEST_ROOT));
    expect(skills.length).toBeGreaterThanOrEqual(1);
    const basic = skills.find((s) => s.name === 'test-basic');
    expect(basic).toBeDefined();
    expect(basic!.description).toBe('A basic test skill for unit testing');
    expect(basic!.skillPath).toBe(join(TEST_CODINGCODE_DIR, 'skills', 'test-basic', 'SKILL.md'));
    expect(basic).toEqual({
      name: 'test-basic',
      description: 'A basic test skill for unit testing',
      skillPath: join(TEST_CODINGCODE_DIR, 'skills', 'test-basic', 'SKILL.md'),
    });
  });

  it('does not load skill body or attachment files during discovery', () => {
    const skillDir = join(TEST_CODINGCODE_DIR, 'skills', 'metadata-only');
    mkdirSync(join(skillDir, 'references'), { recursive: true });
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    mkdirSync(join(skillDir, 'assets'), { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: metadata-only\ndescription: Metadata only\n---\nsecret body\n`
    );
    writeFileSync(join(skillDir, 'references', 'guide.md'), 'secret reference');
    writeFileSync(join(skillDir, 'scripts', 'run.sh'), 'secret script');
    writeFileSync(join(skillDir, 'assets', 'image.bin'), Buffer.from([0, 1, 2, 3]));

    runWithSkill((s) => s.evictProject(TEST_ROOT));
    const skill = runWithSkill((s) => s.findByName(TEST_ROOT, 'metadata-only'));

    expect(skill).toEqual({
      name: 'metadata-only',
      description: 'Metadata only',
      skillPath: join(skillDir, 'SKILL.md'),
    });
  });

  it('should cache skills per session (added files not visible without new session)', () => {
    const [before, after] = runWithSharedSkill(
      (s) => s.getAll(TEST_ROOT),
      (s) => {
        // Add a new skill file after the first read
        const dir = join(TEST_CODINGCODE_DIR, 'skills', 'dynamic-skill');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, 'SKILL.md'),
          `---
name: dynamic-skill
description: "Added at runtime"
---
Dynamic skill body.
`
        );
        return s.getAll(TEST_ROOT);
      }
    );

    expect((after as any[]).length).toBe((before as any[]).length);
  });

  it('should parse @skill-name prefix and return matching skill', () => {
    const matched = runWithSkill((s) => s.select(TEST_ROOT, '@test-basic do something'));
    expect(matched).toBeDefined();
    expect(matched!.name).toBe('test-basic');
  });

  it('should support kebab-case skill names in @ prefix', () => {
    const dir = join(TEST_CODINGCODE_DIR, 'skills', 'my-kebab-skill');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---
name: my-kebab-skill
description: "Kebab case test"
---
## Kebab
Testing kebab-case name parsing.
`
    );
    runWithSkill((s) => s.evictProject(TEST_ROOT));
    const matched = runWithSkill((s) => s.select(TEST_ROOT, '@my-kebab-skill run tests'));
    expect(matched).toBeDefined();
    expect(matched!.name).toBe('my-kebab-skill');
  });

  it('should return undefined when @ prefix does not match any skill', () => {
    const matched = runWithSkill((s) => s.select(TEST_ROOT, '@nonexistent do something'));
    expect(matched).toBeUndefined();
  });

  it('should return undefined when no @ prefix in query', () => {
    const matched = runWithSkill((s) => s.select(TEST_ROOT, 'just a normal message'));
    expect(matched).toBeUndefined();
  });

  it('should find skill by name', () => {
    const found = runWithSkill((s) => s.findByName(TEST_ROOT, 'test-basic'));
    expect(found).toBeDefined();
    expect(found!.name).toBe('test-basic');
  });

  it('should extract skill and return clean query', () => {
    const [matched, cleanQuery] = runWithSkill((s) =>
      s.extractSkill(TEST_ROOT, '@test-basic   do the refactoring work')
    );
    expect(matched).toBeDefined();
    expect(matched!.name).toBe('test-basic');
    expect(cleanQuery).toBe('do the refactoring work');
  });

});
