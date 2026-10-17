import { test, expect } from 'claude-code/testing'
import { parseTasks, inferActive, barCells, barRuns } from './parse'

const md = `- [X] T001 done
- [ ] T002 edit \`src/a/b.py\`
- [ ] T003 [BLOCKED: needs decision on name]
- [ ] T004 [BLOCKED: waiting on CI]
`
test('parses done, blocked kinds', () => {
  const t = parseTasks(md)
  expect(t.filter(x => x.done).length).toBe(1)
  expect(t[2].blocked).toBe('decision')
  expect(t[3].blocked).toBe('other')
})
test('active is inferred only from evidence', () => {
  const t = parseTasks(md)
  expect(inferActive(t, 'nothing')).toBe(null)
  expect(inferActive(t, 'Edit src/a/b.py')).toBe('T002')
  expect(inferActive(t, 'working on T001')).toBe(null)
})

const sum = (c: { done: number; doing: number; blocked: number; backlog: number }) => c.done + c.doing + c.blocked + c.backlog
test('bar splits the width in proportion and adds up', () => {
  const c = barCells({ done: 20, doing: 4, blocked: 0, backlog: 16 }, 80)
  expect(sum(c)).toBe(80)
  expect(c.done).toBe(40)
  expect(c.doing).toBe(8)
  expect(c.blocked).toBe(0)
  expect(c.backlog).toBe(32)
})
test('a lone blocked task is never invisible', () => {
  const c = barCells({ done: 100, doing: 0, blocked: 1, backlog: 0 }, 80)
  expect(c.blocked).toBe(1)
  expect(sum(c)).toBe(80)
})
test('no tasks gives an empty bar', () => {
  expect(sum(barCells({ done: 0, doing: 0, blocked: 0, backlog: 0 }, 80))).toBe(0)
  expect(barRuns({ done: 0, doing: 0, blocked: 0, backlog: 0 }, 40).length).toBe(0)
})
test('runs cover the cells and mark a boundary with a half block', () => {
  const runs = barRuns({ done: 1, doing: 0, blocked: 0, backlog: 1 }, 3)
  expect(runs.reduce((n, r) => n + r.n, 0)).toBe(3)
  expect(runs.some(r => r.glyph === '▀' && r.top === 'done' && r.bottom === 'backlog')).toBe(true)
})
