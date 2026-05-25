import { exec } from 'child_process'
import { promisify } from 'util'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import type { LLMTool } from './llm.client'
import type { FileNode } from '@shared/types'

const execAsync = promisify(exec)

export interface ToolResult {
  output: string
  exitCode?: number
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>, cwd: string, signal?: AbortSignal) => Promise<ToolResult>
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'out', '__pycache__', '.venv'])

function buildFileTree(dir: string, maxDepth = 4, depth = 0): FileNode[] {
  if (depth >= maxDepth) return []
  try {
    return readdirSync(dir)
      .filter((name) => !IGNORED_DIRS.has(name))
      .map((name) => {
        const fullPath = join(dir, name)
        try {
          const stat = statSync(fullPath)
          const node: FileNode = { name, path: fullPath, type: stat.isDirectory() ? 'directory' : 'file' }
          if (node.type === 'directory') {
            node.children = buildFileTree(fullPath, maxDepth, depth + 1)
          }
          return node
        } catch {
          return { name, path: fullPath, type: 'file' as const }
        }
      })
  } catch {
    return []
  }
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_dir',
    description: 'List the contents of a directory. Returns a tree of files and folders.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list. Defaults to current working directory.' },
      },
      required: [],
    },
    async execute(args, cwd) {
      const targetPath = resolve(cwd, (args.path as string) || '.')
      const nodes = buildFileTree(targetPath, 3)
      function format(nodes: FileNode[], indent = 0): string {
        return nodes.map((n) => {
          const prefix = '  '.repeat(indent) + (n.type === 'directory' ? '📁 ' : '📄 ')
          const children = n.children ? '\n' + format(n.children, indent + 1) : ''
          return prefix + n.name + children
        }).join('\n')
      }
      return { output: format(nodes) || '(empty directory)' }
    },
  },
  {
    name: 'file_read',
    description: 'Read the contents of a file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to read.' },
      },
      required: ['path'],
    },
    async execute(args, cwd) {
      const fullPath = resolve(cwd, args.path as string)
      try {
        const content = readFileSync(fullPath, 'utf-8')
        return { output: content }
      } catch (err) {
        return { output: `Error reading file: ${err}`, exitCode: 1 }
      }
    },
  },
  {
    name: 'apply_patch',
    description: 'Write content to a file, overwriting existing content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to write.' },
        content: { type: 'string', description: 'Content to write to the file.' },
      },
      required: ['path', 'content'],
    },
    async execute(args, cwd) {
      const fullPath = resolve(cwd, args.path as string)
      try {
        writeFileSync(fullPath, args.content as string, 'utf-8')
        return { output: `File written successfully: ${fullPath}` }
      } catch (err) {
        return { output: `Error writing file: ${err}`, exitCode: 1 }
      }
    },
  },
  {
    name: 'shell',
    description: 'Execute a shell command and return the output.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute.' },
        cwd: { type: 'string', description: 'Working directory for the command.' },
      },
      required: ['command'],
    },
    async execute(args, defaultCwd, signal) {
      const cmd = args.command as string
      const runCwd = (args.cwd as string) || defaultCwd
      try {
        const { stdout, stderr } = await execAsync(cmd, {
          cwd: runCwd,
          timeout: 30000,
          signal,
        })
        const combined = [stdout, stderr].filter(Boolean).join('\n')
        return { output: combined || '(no output)', exitCode: 0 }
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number; message?: string }
        const output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n')
        return { output: output || String(err), exitCode: e.code ?? 1 }
      }
    },
  },
  {
    name: 'search',
    description: 'Search for a pattern in files using ripgrep or grep.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex or literal string).' },
        path: { type: 'string', description: 'Directory or file to search in.' },
        literal: { type: 'boolean', description: 'If true, treat pattern as literal string.' },
      },
      required: ['pattern'],
    },
    async execute(args, cwd) {
      const pattern = args.pattern as string
      const searchPath = args.path ? resolve(cwd, args.path as string) : cwd
      const flag = args.literal ? '-F' : '-E'
      // Try rg first, fall back to grep
      try {
        const { stdout } = await execAsync(`rg ${flag} --line-number --max-count=50 ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)}`, {
          cwd,
          timeout: 10000,
        })
        return { output: stdout || '(no matches)', exitCode: 0 }
      } catch {
        try {
          const { stdout } = await execAsync(`grep -rn ${flag} ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)}`, {
            cwd,
            timeout: 10000,
          })
          return { output: stdout || '(no matches)', exitCode: 0 }
        } catch (err: unknown) {
          const e = err as { stdout?: string; code?: number }
          if (e.code === 1) return { output: '(no matches)', exitCode: 0 }
          return { output: String(err), exitCode: 1 }
        }
      }
    },
  },
]

export const TOOL_MAP = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]))

export function getLLMTools(): LLMTool[] {
  return TOOL_DEFINITIONS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
  signal?: AbortSignal
): Promise<ToolResult> {
  const tool = TOOL_MAP.get(name)
  if (!tool) return { output: `Unknown tool: ${name}`, exitCode: 1 }
  return tool.execute(args, cwd, signal)
}
