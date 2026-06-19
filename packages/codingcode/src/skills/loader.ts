import { statSync } from 'fs';
import { basename } from 'path';
import type { Skill } from './types.js';
import { readSkillMd, readFileContent, getFilesInDir, getMimeType } from './source.js';

export function loadSkill(dirPath: string): Skill | null {
  const parsed = readSkillMd(dirPath);
  if (!parsed) return null;

  const { frontMatter, body } = parsed;

  const name = frontMatter.name || basename(dirPath);
  const description = frontMatter.description || '';
  const instruction = body;

  // Extract metadata (everything except name and description)
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontMatter)) {
    if (key !== 'name' && key !== 'description') {
      metadata[key] = value;
    }
  }

  // Load references
  const refsDir = `${dirPath}/references`;
  const refs: Array<{ path: string; content: string }> = [];
  for (const refPath of getFilesInDir(refsDir)) {
    const content = readFileContent(refPath);
    if (content !== null) {
      refs.push({ path: refPath, content });
    }
  }

  // Load scripts
  const scriptsDir = `${dirPath}/scripts`;
  const scripts: Array<{ path: string; content: string }> = [];
  for (const scriptPath of getFilesInDir(scriptsDir)) {
    const content = readFileContent(scriptPath);
    if (content !== null) {
      scripts.push({ path: scriptPath, content });
    }
  }

  // Load assets (metadata only, not binary content)
  const assetsDir = `${dirPath}/assets`;
  const assets: Array<{ path: string; mimeType: string; size: number }> = [];
  for (const assetPath of getFilesInDir(assetsDir)) {
    try {
      const st = statSync(assetPath);
      assets.push({
        path: assetPath,
        mimeType: getMimeType(assetPath),
        size: st.size,
      });
    } catch {
      // skip
    }
  }

  return { name, description, instruction, references: refs, scripts, assets, metadata };
}
