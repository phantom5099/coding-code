import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function sourceContent(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', '..', 'src', relativePath), 'utf-8')
}

describe('system prompt cwd correctness', () => {
  const agentSource = sourceContent('agent/agent.ts')

  it('buildSystemPrompt should use projectPath (state.cwd), not getWorkspaceCwd()', () => {
    // Verify the buildSystemPrompt call uses projectPath variable
    // (line 143: const projectPath = state.cwd;)
    // NOT getWorkspaceCwd() which is a module-level stale value

    // The import of getWorkspaceCwd should not exist (we removed it)
    expect(agentSource).not.toMatch(/import.*getWorkspaceCwd.*from/)

    // The buildSystemPrompt call site should reference projectPath
    // Search for the call pattern: buildSystemPrompt({...cwd: projectPath...})
    const hasCorrectCwd = /cwd:\s*projectPath/.test(agentSource)
    expect(hasCorrectCwd).toBe(true)
  })

  it('projectPath is derived from state.cwd (not module-level)', () => {
    // Verify the projectPath declaration correctly reads from state
    const projectPathDeclared = /const projectPath = state\.cwd/.test(agentSource)
    expect(projectPathDeclared).toBe(true)
  })
})
