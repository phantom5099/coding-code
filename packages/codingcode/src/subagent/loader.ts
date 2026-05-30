import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import type { SubagentProfile } from './registry.js';
import { createLogger } from '@codingcode/infra';

const logger = createLogger();

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
          logger.warn(`Skipping agent file ${file}: missing required name or description`);
          continue;
        }

        const profile: SubagentProfile = {
          name,
          description,
          systemPrompt: body || 'You are a specialized agent.',
          tools: Array.isArray(frontmatter.tools) ? frontmatter.tools.map(String) : undefined,
          mcpServers: Array.isArray(frontmatter.mcpServers) ? frontmatter.mcpServers.map(String) : undefined,
          readonly: Boolean(frontmatter.readonly),
          maxSteps: typeof frontmatter.maxSteps === 'number' ? frontmatter.maxSteps : undefined,
          model: typeof frontmatter.model === 'string' ? frontmatter.model : undefined,
        };

        profiles.push(profile);
      } catch (err) {
        logger.warn(`Failed to parse agent profile ${file}:`, err);
      }
    }
  } catch (err) {
    logger.warn(`Failed to read agents directory:`, err);
  }

  return profiles;
}

function serializeAgentProfile(profile: SubagentProfile): string {
  const fm: string[] = ['---'];
  fm.push(`name: ${profile.name}`);
  fm.push(`description: ${profile.description}`);
  if (profile.tools && profile.tools.length > 0) {
    fm.push(`tools: ${JSON.stringify(profile.tools)}`);
  }
  if (profile.mcpServers && profile.mcpServers.length > 0) {
    fm.push(`mcpServers: ${JSON.stringify(profile.mcpServers)}`);
  }
  if (profile.readonly) fm.push(`readonly: true`);
  if (profile.maxSteps !== undefined) fm.push(`maxSteps: ${profile.maxSteps}`);
  if (profile.model) fm.push(`model: ${profile.model}`);
  fm.push('---');
  fm.push('');
  fm.push(profile.systemPrompt || 'You are a specialized agent.');
  return fm.join('\n');
}

function agentNameToFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') + '.md';
}

function findAgentFile(projectCwd: string, name: string): string | null {
  const agentsDir = join(projectCwd, '.codingcode', 'agents');
  if (!existsSync(agentsDir)) return null;
  const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = join(agentsDir, file);
    const content = readFileSync(filePath, 'utf-8');
    const { frontmatter } = parseFrontmatter(content);
    if (frontmatter.name === name) return filePath;
  }
  return null;
}

export function writeAgentProfile(projectCwd: string, profile: SubagentProfile): void {
  const agentsDir = join(projectCwd, '.codingcode', 'agents');
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
  const existing = findAgentFile(projectCwd, profile.name);
  const filePath = existing ?? join(agentsDir, agentNameToFilename(profile.name));
  writeFileSync(filePath, serializeAgentProfile(profile), 'utf-8');
}

export function updateAgentProfile(projectCwd: string, oldName: string, profile: SubagentProfile): void {
  if (oldName !== profile.name) {
    const oldFile = findAgentFile(projectCwd, oldName);
    if (oldFile) unlinkSync(oldFile);
  }
  writeAgentProfile(projectCwd, profile);
}

export function deleteAgentProfile(projectCwd: string, name: string): void {
  const filePath = findAgentFile(projectCwd, name);
  if (filePath) unlinkSync(filePath);
}
