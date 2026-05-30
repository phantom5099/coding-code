import { describe, it, expect } from 'vitest'
import { enrichTurnDiffs } from '../src/stores/global.store'

describe('enrichTurnDiffs', () => {
  it('adds diff to edit_file tool_result', () => {
    const turn: any = {
      id: '1',
      status: 'completed',
      items: [
        { id: 'tc1', type: 'tool_call', name: 'edit_file', args: { path: 'src/utils.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nc' }, status: 'approved' },
        { id: 'tr1', type: 'tool_result', callId: 'tc1', name: 'edit_file', output: 'File updated' },
      ],
    }
    enrichTurnDiffs(turn)
    const result = turn.items[1] as any
    expect(result.diff).toContain('diff --git a/src/utils.ts b/src/utils.ts')
    expect(result.diff).toContain('-b')
    expect(result.diff).toContain('+B')
    expect(result.filePath).toBe('src/utils.ts')
    expect(result.insertions).toBe(1)
    expect(result.deletions).toBe(1)
  })

  it('adds diff to write_file tool_result', () => {
    const turn: any = {
      id: '1',
      status: 'completed',
      items: [
        { id: 'tc1', type: 'tool_call', name: 'write_file', args: { path: 'README.md', content: '# Title\n\nHello' }, status: 'approved' },
        { id: 'tr1', type: 'tool_result', callId: 'tc1', name: 'write_file', output: 'File written' },
      ],
    }
    enrichTurnDiffs(turn)
    const result = turn.items[1] as any
    expect(result.diff).toContain('new file mode 100644')
    expect(result.diff).toContain('--- /dev/null')
    expect(result.filePath).toBe('README.md')
    expect(result.insertions).toBeGreaterThan(0)
    expect(result.deletions).toBe(0)
  })

  it('does not add diff to non-file tool_result', () => {
    const turn: any = {
      id: '1',
      status: 'completed',
      items: [
        { id: 'tc1', type: 'tool_call', name: 'bash', args: { command: 'echo hi' }, status: 'approved' },
        { id: 'tr1', type: 'tool_result', callId: 'tc1', name: 'bash', output: 'hi' },
      ],
    }
    enrichTurnDiffs(turn)
    const result = turn.items[1] as any
    expect(result.diff).toBeUndefined()
    expect(result.filePath).toBeUndefined()
  })

  it('does not add diff when tool_call is missing', () => {
    const turn: any = {
      id: '1',
      status: 'completed',
      items: [
        { id: 'tr1', type: 'tool_result', callId: 'missing', name: 'edit_file', output: 'File updated' },
      ],
    }
    enrichTurnDiffs(turn)
    const result = turn.items[0] as any
    expect(result.diff).toBeUndefined()
  })
})
