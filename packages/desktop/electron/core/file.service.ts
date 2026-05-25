import { readFileSync, writeFileSync, readdirSync, statSync, watch } from 'fs'
import { join, resolve, relative } from 'path'
import type { FileNode } from '@shared/types'

const IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', 'out', '__pycache__', '.venv'])

export function readFile(filePath: string): string {
  return readFileSync(filePath, 'utf-8')
}

export function writeFile(filePath: string, content: string): void {
  writeFileSync(filePath, content, 'utf-8')
}

function buildTree(dir: string, maxDepth: number, depth: number): FileNode[] {
  if (depth >= maxDepth) return []
  try {
    return readdirSync(dir)
      .filter((name) => !IGNORED.has(name))
      .map((name) => {
        const full = join(dir, name)
        try {
          const stat = statSync(full)
          const node: FileNode = { name, path: full, type: stat.isDirectory() ? 'directory' : 'file' }
          if (node.type === 'directory') node.children = buildTree(full, maxDepth, depth + 1)
          return node
        } catch {
          return { name, path: full, type: 'file' as const }
        }
      })
  } catch {
    return []
  }
}

export function readDir(dir: string): FileNode[] {
  return buildTree(dir, 5, 0)
}

export function searchFiles(query: string, rootDir: string): string[] {
  const results: string[] = []
  const lowerQuery = query.toLowerCase()

  function walk(dir: string) {
    try {
      for (const name of readdirSync(dir)) {
        if (IGNORED.has(name)) continue
        const full = join(dir, name)
        try {
          const stat = statSync(full)
          if (stat.isDirectory()) {
            walk(full)
          } else if (name.toLowerCase().includes(lowerQuery)) {
            results.push(relative(rootDir, full))
            if (results.length >= 50) return
          }
        } catch {}
      }
    } catch {}
  }

  walk(rootDir)
  return results
}

const watchers = new Map<string, ReturnType<typeof watch>>()
let watchIdCounter = 0

export function watchDir(
  dir: string,
  onChange: (payload: { path: string; type: 'add' | 'change' | 'unlink' }) => void
): string {
  const id = `watch_${++watchIdCounter}`
  try {
    const watcher = watch(resolve(dir), { recursive: true }, (_event, filename) => {
      if (!filename) return
      onChange({ path: join(dir, filename), type: 'change' })
    })
    watchers.set(id, watcher)
  } catch {}
  return id
}

export function unwatchDir(id: string): void {
  watchers.get(id)?.close()
  watchers.delete(id)
}
