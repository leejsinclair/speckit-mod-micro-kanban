import type { Task } from '../types'

const LINE = /^\s*[-*]\s+\[([ xX~])\]\s+(T\d+)\b(.*)$/
const BLOCK = /\[(?:BLOCKED|NEEDS[ -]DECISION|DECISION)[^\]]*\]|\bBLOCKED:/i
const DECISION = /decision|awaiting (?:human|maintainer|approval)/i
const PROGRESS = /\[IN[ -]PROGRESS\]/i

export function parseTasks(md: string): Task[] {
  const tasks: Task[] = []
  for (const line of md.split('\n')) {
    const m = LINE.exec(line)
    if (!m) continue
    const done = m[1] === 'x' || m[1] === 'X'
    const block = BLOCK.exec(m[3])
    tasks.push({
      id: m[2],
      text: m[3].trim(),
      done,
      blocked: done || !block ? null : DECISION.test(block[0]) || /needs[ -]decision/i.test(block[0]) ? 'decision' : 'other',
      marked: !done && (m[1] === '~' || PROGRESS.test(m[3])),
    })
  }
  return tasks
}

/** Active task: explicit marker first; else the incomplete task a tool call names (by id, then by file path). */
export function inferActive(tasks: Task[], haystack: string): string | null {
  const open = tasks.filter(t => !t.done && !t.blocked)
  const marked = open.find(t => t.marked)
  if (marked) return marked.id
  for (const id of haystack.match(/\bT\d{3,}\b/g) ?? []) {
    if (open.some(t => t.id === id)) return id
  }
  const paths = (hay: string) => open.find(t => (t.text.match(/`([^`]+\/[^`]+)`/g) ?? []).some(p => hay.includes(p.slice(1, -1))))
  return paths(haystack)?.id ?? null
}

export function fingerprint(tasks: Task[], active: string | null): string {
  return JSON.stringify([tasks.map(t => [t.id, t.done, t.blocked, t.marked]), active])
}

export type Counts = { done: number; doing: number; blocked: number; backlog: number }
export type Segment = keyof Counts

/** Sub-cells for each column out of `width`, in proportion to its tasks (largest remainder); a non-empty column keeps at least one. */
export function barCells(c: Counts, width: number): Counts {
  const keys: Segment[] = ['done', 'doing', 'blocked', 'backlog']
  const total = keys.reduce((n, k) => n + c[k], 0)
  const out: Counts = { done: 0, doing: 0, blocked: 0, backlog: 0 }
  if (total === 0) return out
  const order = keys
    .map(k => {
      const exact = (c[k] * width) / total
      out[k] = Math.floor(exact)
      return { k, r: exact - out[k] }
    })
    .sort((a, b) => b.r - a.r)
  let left = width - keys.reduce((n, k) => n + out[k], 0)
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i]!.k]++
  for (const k of keys) {
    if (c[k] > 0 && out[k] === 0) {
      const big = keys.reduce((a, b) => (out[b] > out[a] ? b : a))
      out[big]--
      out[k] = 1
    }
  }
  return out
}

/** The bar as runs of equal cells: whole cells, or a half-block cell where two columns meet (upper half, lower half). */
export function barRuns(c: Counts, cells: number): { glyph: '█' | '▀'; top: Segment; bottom: Segment; n: number }[] {
  const sub = barCells(c, cells * 2)
  const seq: Segment[] = []
  for (const k of ['done', 'doing', 'blocked', 'backlog'] as Segment[]) for (let i = 0; i < sub[k]; i++) seq.push(k)
  const runs: { glyph: '█' | '▀'; top: Segment; bottom: Segment; n: number }[] = []
  for (let i = 0; i + 1 < seq.length; i += 2) {
    const top = seq[i]!
    const bottom = seq[i + 1]!
    const glyph = top === bottom ? '█' : '▀'
    const last = runs[runs.length - 1]
    if (last && last.glyph === glyph && last.top === top && last.bottom === bottom) last.n++
    else runs.push({ glyph, top, bottom, n: 1 })
  }
  return runs
}
