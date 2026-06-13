import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { Effect, Layer } from 'effect';
import { SkillService } from '../../src/skills/service.js';

const TEST_ROOT = process.cwd();
const TEST_CODINGCODE_DIR = join(TEST_ROOT, '.codingcode');

const SkillTestLayer = SkillService.Default;

const runWithSkill = <A>(f: (skill: SkillService) => Effect.Effect<A>): A =>
  Effect.runSync(Effect.gen(function* () {
    const skill = yield* SkillService;
    return yield* f(skill);
  }).pipe(Effect.provide(SkillTestLayer)));

/** Run multiple operations against the same SkillService instance (shared cache). */
const runWithSharedSkill = <A>(...ops: Array<(skill: SkillService) => Effect.Effect<unknown>>): A[] =>
  Effect.runSync(
    Effect.gen(function* () {
      const skill = yield* SkillService;
      const results: A[] = [];
      for (const op of ops) {
        results.push(yield* op(skill) as A);
      }
      return results;
    }).pipe(Effect.provide(SkillTestLayer))
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
    expect(basic!.instruction).toContain('Test the skill system');
    expect(basic!.metadata.version).toBe('1.0.0');
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

    expect(after.length).toBe(before.length);
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
    const [matched, cleanQuery] = runWithSkill((s) => s.extractSkill(TEST_ROOT, '@test-basic   do the refactoring work'));
    expect(matched).toBeDefined();
    expect(matched!.name).toBe('test-basic');
    expect(cleanQuery).toBe('do the refactoring work');
  });

  it('disableSkill should hide skill from findByName and select', () => {
    runWithSkill((s) => s.disableSkill(TEST_ROOT, 'test-basic'));
    const byName = runWithSkill((s) => s.findByName(TEST_ROOT, 'test-basic'));
    const selected = runWithSkill((s) => s.select(TEST_ROOT, '@test-basic do something'));
    expect(byName).toBeUndefined();
    expect(selected).toBeUndefined();
  });

  it('enableSkill should restore skill visibility after disable', () => {
    runWithSkill((s) => s.disableSkill(TEST_ROOT, 'test-basic'));
    runWithSkill((s) => s.enableSkill(TEST_ROOT, 'test-basic'));
    const found = runWithSkill((s) => s.findByName(TEST_ROOT, 'test-basic'));
    expect(found).toBeDefined();
    expect(found!.name).toBe('test-basic');
  });

  it('listWithStatus should reflect enabled/disabled state', () => {
    const before = runWithSkill((s) => s.listWithStatus(TEST_ROOT));
    runWithSkill((s) => s.disableSkill(TEST_ROOT, 'test-basic'));
    const after = runWithSkill((s) => s.listWithStatus(TEST_ROOT));
    const beforeEntry = before.find((s) => s.name === 'test-basic');
    const afterEntry = after.find((s) => s.name === 'test-basic');
    expect(beforeEntry?.enabled).toBe(true);
    expect(afterEntry?.enabled).toBe(false);
  });
});
