import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { SkillService } from '../../src/skills/index.js';
import { AppLayer } from '../../src/layer.js';

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

const TEST_ROOT = process.cwd();
const TEST_CODINGCODE_DIR = join(TEST_ROOT, '.codingcode');

describe('SkillService', () => {
  beforeEach(() => {
    if (existsSync(TEST_CODINGCODE_DIR)) rmSync(TEST_CODINGCODE_DIR, { recursive: true, force: true });
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
`);
  });

  afterEach(() => {
    if (existsSync(TEST_CODINGCODE_DIR)) rmSync(TEST_CODINGCODE_DIR, { recursive: true, force: true });
  });

  it('should load skills from .codingcode/skills/ on demand', async () => {
    const program = Effect.gen(function* () {
      const skill = yield* SkillService;
      const all = yield* skill.getAll();
      return all;
    });

    const skills = await runWithLayer(program);
    expect(skills.length).toBeGreaterThanOrEqual(1);
    const basic = skills.find((s) => s.name === 'test-basic');
    expect(basic).toBeDefined();
    expect(basic!.description).toBe('A basic test skill for unit testing');
    expect(basic!.instruction).toContain('Test the skill system');
    expect(basic!.metadata.version).toBe('1.0.0');
  });

  it('should pick up newly added skill files without reload', async () => {
    const program = Effect.gen(function* () {
      const skill = yield* SkillService;
      const before = yield* skill.getAll();

      const dir = join(TEST_CODINGCODE_DIR, 'skills', 'dynamic-skill');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `---
name: dynamic-skill
description: "Added at runtime"
---
Dynamic skill body.
`);

      const after = yield* skill.getAll();
      return { before: before.length, after: after.length };
    });

    const { before, after } = await runWithLayer(program);
    expect(after).toBe(before + 1);
  });

  it('should parse @skill-name prefix and return matching skill', async () => {
    const program = Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* skill.select('@test-basic do something');
    });

    const matched = await runWithLayer(program);
    expect(matched).toBeDefined();
    expect(matched!.name).toBe('test-basic');
  });

  it('should support kebab-case skill names in @ prefix', async () => {
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
`);
    const program = Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* skill.select('@my-kebab-skill run tests');
    });

    const matched = await runWithLayer(program);
    expect(matched).toBeDefined();
    expect(matched!.name).toBe('my-kebab-skill');
  });

  it('should return undefined when @ prefix does not match any skill', async () => {
    const program = Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* skill.select('@nonexistent do something');
    });

    const matched = await runWithLayer(program);
    expect(matched).toBeUndefined();
  });

  it('should return undefined when no @ prefix in query', async () => {
    const program = Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* skill.select('just a normal message');
    });

    const matched = await runWithLayer(program);
    expect(matched).toBeUndefined();
  });

  it('should find skill by name', async () => {
    const program = Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* skill.findByName('test-basic');
    });

    const found = await runWithLayer(program);
    expect(found).toBeDefined();
    expect(found!.name).toBe('test-basic');
  });

  it('should extract skill and return clean query', async () => {
    const program = Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* skill.extractSkill('@test-basic   do the refactoring work');
    });

    const [matched, cleanQuery] = await runWithLayer(program);
    expect(matched).toBeDefined();
    expect(matched!.name).toBe('test-basic');
    expect(cleanQuery).toBe('do the refactoring work');
  });

  it('disableSkill should hide skill from findByName and select', async () => {
    const program = Effect.gen(function* () {
      const skill = yield* SkillService;
      yield* skill.disableSkill('test-basic');
      const byName = yield* skill.findByName('test-basic');
      const selected = yield* skill.select('@test-basic do something');
      return { byName, selected };
    });

    const result = await runWithLayer(program);
    expect(result.byName).toBeUndefined();
    expect(result.selected).toBeUndefined();
  });

  it('enableSkill should restore skill visibility after disable', async () => {
    const program = Effect.gen(function* () {
      const skill = yield* SkillService;
      yield* skill.disableSkill('test-basic');
      yield* skill.enableSkill('test-basic');
      const found = yield* skill.findByName('test-basic');
      return found;
    });

    const result = await runWithLayer(program);
    expect(result).toBeDefined();
    expect(result!.name).toBe('test-basic');
  });

  it('listWithStatus should reflect enabled/disabled state', async () => {
    const program = Effect.gen(function* () {
      const skill = yield* SkillService;
      const before = yield* skill.listWithStatus();
      yield* skill.disableSkill('test-basic');
      const after = yield* skill.listWithStatus();
      return { before, after };
    });

    const { before, after } = await runWithLayer(program);
    const beforeEntry = before.find(s => s.name === 'test-basic');
    const afterEntry = after.find(s => s.name === 'test-basic');
    expect(beforeEntry?.enabled).toBe(true);
    expect(afterEntry?.enabled).toBe(false);
  });
});
