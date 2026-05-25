import { describe, it, expect } from 'vitest'
import { requiresApproval } from '../electron/core/approval.service'

describe('requiresApproval', () => {
  describe('suggest policy', () => {
    it('requires approval for all tools', () => {
      expect(requiresApproval('list_dir', {}, 'suggest')).toBe(true)
      expect(requiresApproval('file_read', { path: 'foo.ts' }, 'suggest')).toBe(true)
      expect(requiresApproval('apply_patch', { path: 'foo.ts', content: '' }, 'suggest')).toBe(true)
      expect(requiresApproval('shell', { command: 'ls' }, 'suggest')).toBe(true)
      expect(requiresApproval('search', { pattern: 'foo' }, 'suggest')).toBe(true)
    })
  })

  describe('auto-edit policy', () => {
    it('allows file tools through', () => {
      expect(requiresApproval('list_dir', {}, 'auto-edit')).toBe(false)
      expect(requiresApproval('file_read', { path: 'foo.ts' }, 'auto-edit')).toBe(false)
      expect(requiresApproval('apply_patch', { path: 'foo.ts', content: '' }, 'auto-edit')).toBe(false)
      expect(requiresApproval('search', { pattern: 'foo' }, 'auto-edit')).toBe(false)
    })

    it('blocks shell commands', () => {
      expect(requiresApproval('shell', { command: 'ls' }, 'auto-edit')).toBe(true)
    })
  })

  describe('full-auto policy', () => {
    it('allows all tools', () => {
      expect(requiresApproval('list_dir', {}, 'full-auto')).toBe(false)
      expect(requiresApproval('shell', { command: 'ls' }, 'full-auto')).toBe(false)
      expect(requiresApproval('apply_patch', { path: 'foo.ts', content: '' }, 'full-auto')).toBe(false)
    })

    it('still blocks dangerous shell commands', () => {
      expect(requiresApproval('shell', { command: 'rm -rf /' }, 'full-auto')).toBe(true)
      expect(requiresApproval('shell', { command: 'git push --force origin main' }, 'full-auto')).toBe(true)
      expect(requiresApproval('shell', { command: 'DROP TABLE users' }, 'full-auto')).toBe(true)
    })
  })
})
