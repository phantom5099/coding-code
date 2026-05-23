import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { SubagentProfile } from './registry.js';

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return { frontmatter: {}, body: content };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return { frontmatter: {}, body: content };
  }

  const fmLines = lines.slice(1, endIdx);
  const frontmatter: Record<string, unknown> = {};
  for (const line of fmLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value: unknown = line.slice(colonIdx + 1).trim();
      // Parse YAML-like values
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (value === 'null' || value === '') value = null;
      else if (typeof value === 'string' && !isNaN(Number(value))) value = Number(value);
      // Handle arrays: JSON ["a","b"] or YAML-style [a, b, c]
      else if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        const strValue = value;
        try {
          value = JSON.parse(strValue);
        } catch {
          const inner = strValue.slice(1, -1).trim();
          if (inner) {
            value = inner.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
          } else {
            value = [];
          }
        }
      }
      frontmatter[key] = value;
    }
  }

  const body = lines.slice(endIdx + 1).join('\n').trim();
  return { frontmatter, body };
}

export function loadAgentProfiles(projectCwd: string): SubagentProfile[] {
  const agentsDir = join(projectCwd, '.codingcode', 'agents');
  if (!existsSync(agentsDir)) {
    return [];
  }

  const profiles: SubagentProfile[] = [];
  try {
    const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const filePath = join(agentsDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);

        const name = frontmatter.name as string | undefined;
        const description = frontmatter.description as string | undefined;

        if (!name || !description) {
          console.warn(`Skipping agent file ${file}: missing required name or description`);
          continue;
        }

        const profile: SubagentProfile = {
          name,
          description,
          systemPrompt: body || 'You are a specialized agent.',
          tools: Array.isArray(frontmatter.tools) ? frontmatter.tools.map(String) : undefined,
          readonly: Boolean(frontmatter.readonly),
          maxSteps: typeof frontmatter.maxSteps === 'number' ? frontmatter.maxSteps : undefined,
          model: typeof frontmatter.model === 'string' ? frontmatter.model : undefined,
        };

        profiles.push(profile);
      } catch (err) {
        console.warn(`Failed to parse agent profile ${file}:`, err);
      }
    }
  } catch (err) {
    console.warn(`Failed to read agents directory:`, err);
  }

  return profiles;
}
