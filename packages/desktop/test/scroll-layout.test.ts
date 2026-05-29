import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function classNamesFromSource(relativePath: string): string[] {
  const src = readFileSync(resolve(__dirname, '..', 'src', relativePath), 'utf-8')
  const matches = src.matchAll(/className="([^"]*)"/g)
  return [...matches].map((m) => m[1]!)
}

describe('MessageStream scroll layout', () => {
  const allClasses = classNamesFromSource('agent/MessageStream.tsx')

  it('Virtuoso container (large list) should have min-h-0', () => {
    // The div wrapping Virtuoso must have min-h-0 so its flex-1
    // can shrink below content height in the AgentWorkspace flex column
    const virtuosoWrap = allClasses.find((c) =>
      c.includes('flex-1') && c.includes('flex-col') && c.includes('min-h-0'),
    )
    expect(virtuosoWrap).toBeTruthy()
  })

  it('plain scroll container (small list) should have min-h-0', () => {
    // The div wrapping the native scrollable area must also have min-h-0
    // for the same reason — prevents min-height: auto from blocking shrink
    const scrollContainerWrap = allClasses.find((c) =>
      c.includes('flex-1') && c.includes('flex-col') && c.includes('min-h-0'),
    )
    expect(scrollContainerWrap).toBeTruthy()
  })

  it('both container variants have min-h-0', () => {
    const minH0Count = allClasses.filter((c) =>
      c.includes('flex-1') && c.includes('flex-col') && c.includes('min-h-0'),
    ).length
    // One for Virtuoso case, one for plain div case
    expect(minH0Count).toBeGreaterThanOrEqual(2)
  })
})
