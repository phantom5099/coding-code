import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(__dirname, '..');

describe('menu.ts deletion - no dead IPC events', () => {
  it('menu.ts file should not exist on disk', () => {
    const menuPath = path.resolve(rootDir, 'electron/menu.ts');
    expect(fs.existsSync(menuPath)).toBe(false);
  });

  it('main.ts source should not reference createMenu', () => {
    const mainPath = path.resolve(rootDir, 'electron/main.ts');
    const source = fs.readFileSync(mainPath, 'utf-8');
    expect(source).not.toContain('createMenu');
    expect(source).not.toContain('./menu');
  });
});

describe('App.tsx - no menu:switchMode listener', () => {
  it('App.tsx source should not contain menu:switchMode or menu:openFolder', () => {
    const appPath = path.resolve(rootDir, 'src/App.tsx');
    const source = fs.readFileSync(appPath, 'utf-8');
    expect(source).not.toContain('menu:switchMode');
    expect(source).not.toContain('menu:openFolder');
  });
});

describe('IPC events - no orphaned menu events in renderer', () => {
  it('no source file under src/ should reference menu:openFolder', () => {
    const srcDir = path.resolve(rootDir, 'src');
    const files = walkDir(srcDir, '.ts', '.tsx');
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toContain('menu:openFolder');
    }
  });
});

function walkDir(dir: string, ...extensions: string[]): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, ...extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}
