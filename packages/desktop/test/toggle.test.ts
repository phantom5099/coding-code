import { describe, expect, it } from 'vitest'
import { getToggleThumbClassName } from '../src/settings/Toggle'

describe('Toggle', () => {
  it('keeps the disabled thumb aligned inside the track', () => {
    const className = getToggleThumbClassName(false)

    expect(className).toContain('left-0.5')
    expect(className).toContain('top-0.5')
    expect(className).toContain('w-3')
    expect(className).toContain('h-3')
    expect(className).toContain('translate-x-0')
  })

  it('keeps the enabled thumb aligned inside the track', () => {
    const className = getToggleThumbClassName(true)

    expect(className).toContain('left-0.5')
    expect(className).toContain('top-0.5')
    expect(className).toContain('w-3')
    expect(className).toContain('h-3')
    expect(className).toContain('translate-x-4')
  })
})
