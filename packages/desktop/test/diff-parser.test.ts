import { describe, it, expect } from 'vitest'
import { parseUnifiedDiff, isEmptyDiff } from '../src/lib/diff-parser'

const NEW_FILE_DIFF = `diff --git a/赞颂祖国人.md b/赞颂祖国人.md
new file mode 100644
index 0000000..41ea37a
--- /dev/null
+++ b/赞颂祖国人.md
@@ -0,0 +1,11 @@
+# 赞颂祖国人
+
+祖国人，你是天空中最耀眼的那道光！
+你的微笑如阳光般温暖大地，
+你的力量如雷霆般震慑群邪。
+你用坚定的目光守护着每一寸山河，
+用宽厚的臂膀撑起亿万人的希望。
+你是自由的化身，是正义的灯塔，
+是每一个仰望天空的人心中最崇高的信仰！
+祖国人，万岁！你的名字将在历史上永远闪耀！
+**我们爱你，就像爱这片土地一样深沉！**
`

const EDIT_DIFF = `diff --git a/src/utils.ts b/src/utils.ts
index e69de29..b2d1c4f 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,5 +1,5 @@
 export function greet(name: string) {
-  return 'Hello ' + name;
+  return 'Hello, ' + name + '!';
 }
 
 export function add(a: number, b: number) {
@@ -8,7 +8,6 @@ export function add(a: number, b: number) {
   return a + b;
 }
 
-// Removed comment
 export function subtract(a: number, b: number) {
   return a - b;
 }
`

describe('parseUnifiedDiff', () => {
  it('parses new file diff', () => {
    const result = parseUnifiedDiff(NEW_FILE_DIFF)
    expect(result).toHaveLength(1)
    expect(result[0]!.fileName).toBe('赞颂祖国人.md')
    expect(result[0]!.hunks).toHaveLength(1)

    const hunk = result[0]!.hunks[0]!
    expect(hunk.oldStart).toBe(0)
    expect(hunk.oldLen).toBe(0)
    expect(hunk.newStart).toBe(1)
    expect(hunk.newLen).toBe(11)
    expect(hunk.lines).toHaveLength(11)

    // All lines are additions
    for (const line of hunk.lines) {
      expect(line.type).toBe('add')
      expect(line.oldLineNum).toBeNull()
      expect(line.newLineNum).toBeGreaterThanOrEqual(1)
      expect(line.newLineNum).toBeLessThanOrEqual(11)
    }

    // Verify first and last line
    expect(hunk.lines[0]!.text).toBe('# 赞颂祖国人')
    expect(hunk.lines[0]!.newLineNum).toBe(1)
    expect(hunk.lines[10]!.text).toBe('**我们爱你，就像爱这片土地一样深沉！**')
    expect(hunk.lines[10]!.newLineNum).toBe(11)
  })

  it('parses edit diff with multiple hunks', () => {
    const result = parseUnifiedDiff(EDIT_DIFF)
    expect(result).toHaveLength(1)
    expect(result[0]!.fileName).toBe('src/utils.ts')
    expect(result[0]!.hunks).toHaveLength(2)

    const hunk1 = result[0]!.hunks[0]!
    expect(hunk1.oldStart).toBe(1)
    expect(hunk1.newStart).toBe(1)
    expect(hunk1.lines.some((l) => l.type === 'remove')).toBe(true)
    expect(hunk1.lines.some((l) => l.type === 'add')).toBe(true)
    expect(hunk1.lines.some((l) => l.type === 'context')).toBe(true)

    // Check line numbering in first hunk
    const removeLine = hunk1.lines.find((l) => l.type === 'remove')
    expect(removeLine).toBeDefined()
    expect(removeLine!.oldLineNum).toBe(2)
    expect(removeLine!.newLineNum).toBeNull()

    const addLine = hunk1.lines.find((l) => l.type === 'add')
    expect(addLine).toBeDefined()
    expect(addLine!.newLineNum).toBe(2)
    expect(addLine!.oldLineNum).toBeNull()

    // Context line should have both line numbers
    const ctxLine = hunk1.lines.find((l) => l.type === 'context')
    expect(ctxLine).toBeDefined()
    expect(ctxLine!.oldLineNum).not.toBeNull()
    expect(ctxLine!.newLineNum).not.toBeNull()

    const hunk2 = result[0]!.hunks[1]!
    expect(hunk2.oldStart).toBe(8)
    expect(hunk2.newStart).toBe(8)
    // Single removal line
    expect(hunk2.lines.filter((l) => l.type === 'remove')).toHaveLength(1)
    expect(hunk2.lines.filter((l) => l.type === 'context')).toHaveLength(6)
  })

  it('filters out metadata lines', () => {
    const result = parseUnifiedDiff(NEW_FILE_DIFF)
    const texts = result.flatMap((f) => f.hunks.flatMap((h) => h.lines.map((l) => l.text)))
    expect(texts.some((t) => t.includes('diff --git'))).toBe(false)
    expect(texts.some((t) => t.includes('index '))).toBe(false)
    expect(texts.some((t) => t.includes('+++ '))).toBe(false)
    expect(texts.some((t) => t.includes('--- '))).toBe(false)
  })

  it('handles empty diff', () => {
    expect(parseUnifiedDiff('')).toHaveLength(0)
    expect(parseUnifiedDiff('\n\n')).toHaveLength(0)
  })

  it('computes correct absolute line numbers across hunks', () => {
    const result = parseUnifiedDiff(EDIT_DIFF)
    const hunk2 = result[0]!.hunks[1]!
    // Hunk 2 starts at oldLine=8 newLine=8
    // First context line should be line 8
    const firstCtx = hunk2.lines.find((l) => l.type === 'context')
    expect(firstCtx!.oldLineNum).toBe(8)
    expect(firstCtx!.newLineNum).toBe(8)
  })
})

describe('isEmptyDiff', () => {
  it('returns true for empty strings', () => {
    expect(isEmptyDiff('')).toBe(true)
    expect(isEmptyDiff('   ')).toBe(true)
  })

  it('returns false for valid diff', () => {
    expect(isEmptyDiff(NEW_FILE_DIFF)).toBe(false)
  })
})
