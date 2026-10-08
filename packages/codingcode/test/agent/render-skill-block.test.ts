import { describe, it, expect } from 'vitest';
import { renderSkillBlock } from '../../src/agent/prompt.js';
import type { Skill } from '../../src/skills/types.js';

function skill(name: string, skillPath: string): Skill {
  return { name, description: `${name} description`, skillPath };
}

describe('renderSkillBlock', () => {
  it('produces nothing when no skill was selected', () => {
    expect(renderSkillBlock([])).toBe('');
  });

  it('carries the selected skill name, path and full body', () => {
    const out = renderSkillBlock([
      { skill: skill('aaa-skill', '/tmp/aaa/SKILL.md'), body: 'body-of-aaa' },
    ]);

    expect(out).toContain('aaa-skill');
    expect(out).toContain('/tmp/aaa/SKILL.md');
    expect(out).toContain('body-of-aaa');
  });

  it('renders every selected skill in the given order', () => {
    const out = renderSkillBlock([
      { skill: skill('aaa-skill', '/tmp/aaa/SKILL.md'), body: 'body-of-aaa' },
      { skill: skill('bbb-skill', '/tmp/bbb/SKILL.md'), body: 'body-of-bbb' },
    ]);

    expect(out).toContain('aaa-skill');
    expect(out).toContain('body-of-aaa');
    expect(out).toContain('bbb-skill');
    expect(out).toContain('body-of-bbb');
    expect(out.indexOf('body-of-aaa')).toBeLessThan(out.indexOf('body-of-bbb'));
  });
});
