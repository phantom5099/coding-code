import { describe, it, expect } from 'vitest';
import { buildWelcomeContent } from '../../src/components/WelcomePanel.js';

describe('buildWelcomeContent', () => {
  it('should contain CODING CODE ASCII art banner', () => {
    const content = buildWelcomeContent();
    expect(content).toContain('▄█████');
    expect(content).toContain('▀█████');
    expect(content).toContain('Type /help for available commands.');
  });

  it('should not contain Model, Role, or Session lines', () => {
    const content = buildWelcomeContent();
    expect(content).not.toContain('Model:');
    expect(content).not.toContain('Role:');
    expect(content).not.toContain('Session:');
  });

  it('should return a non-empty string', () => {
    const content = buildWelcomeContent();
    expect(content.length).toBeGreaterThan(0);
  });
});
