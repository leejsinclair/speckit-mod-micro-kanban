import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Board } from '../types'
import { barRuns, fingerprint, inferActive, parseTasks } from './parse'

const board = atom({ plugin: 'micro-kanban', key: 'board' } as const, { kind: 'unknown', reason: 'not loaded yet' } as Board)
const isActive = atom({ plugin: 'micro-kanban', key: 'isActive' } as const, false)
const isHidden = atom({ plugin: 'micro-kanban', key: 'isHidden' } as const, false)

const COLOR = { backlog: 'gray', doing: 'cyan', blocked: 'red', done: 'green' } as const

const st = { lastTool: '', lastActive: null as string | null, lastPrint: '' }

async function projectRoot($: any): Promise<string> {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'])
    const t = String(r.stdout).trim()
    if (t) return t
  } catch {}
  return '.'
}

// Absolute path of the feature directory, found from the project root so the working directory does not matter.
async function featureDir($: any): Promise<string | null> {
  const root = await projectRoot($)
  const abs = (p: string) => (p.startsWith('/') ? p : `${root}/${p}`)
  try {
    const j = JSON.parse(await $.fs.read(`${root}/.specify/feature.json`))
    if (typeof j.feature_directory === 'string') return abs(j.feature_directory)
  } catch {}
  try {
    const r = await $.process.run(['git', '-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'])
    const b = String(r.stdout).trim()
    if (/^\d{3,}-/.test(b) && (await $.fs.exists(`${root}/specs/${b}/tasks.md`))) return `${root}/specs/${b}`
  } catch {}
  return null
}

async function refresh($: any, force = false) {
  if (!(await read($, isActive))) return
  const dir = await featureDir($)
  let next: Board
  if (!dir) {
    next = { kind: 'unknown', reason: 'feature not determined' }
  } else {
    try {
      const tasks = parseTasks(await $.fs.read(`${dir}/tasks.md`))
      if (tasks.length === 0) {
        next = { kind: 'unknown', reason: `no tasks found in ${dir}/tasks.md` }
      } else {
        const marked = tasks.find(t => t.marked && !t.done)
        st.lastActive = inferActive(tasks, st.lastTool) ?? (st.lastActive && tasks.some(t => t.id === st.lastActive && !t.done && !t.blocked) ? st.lastActive : null)
        next = {
          kind: 'ok',
          feature: dir.split('/').pop() ?? dir,
          tasks,
          active: marked?.id ?? st.lastActive,
          activeFrom: marked ? 'tasks.md' : st.lastActive ? 'inferred' : null,
        }
      }
    } catch {
      next = { kind: 'unknown', reason: `${dir}/tasks.md unreadable` }
    }
  }
  const print = next.kind === 'ok' ? fingerprint(next.tasks, next.active) + next.feature : next.reason
  if (force || print !== st.lastPrint) {
    st.lastPrint = print
    await update($, board, () => next)
  }
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'kanban', description: 'Show a task (T001) or requirement (FR-001) from the current feature; "off"/"on" hides or shows the board' })
    $.clock.every(2000, () => refresh($))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (/speckit[-.:]implement/i.test(e.text)) {
      await update($, isActive, () => true)
      await update($, isHidden, () => false)
      await refresh($, true)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    try {
      st.lastTool = JSON.stringify(e.input ?? e).slice(0, 4000)
    } catch {}
    const r = await next(e)
    await refresh($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('command.run', { command: 'kanban' }, async ($, e) => {
    const arg = String((e as any).args ?? '').trim()
    if (arg === 'off' || arg === 'on') {
      await update($, isHidden, () => arg === 'off')
      return { text: `Board ${arg === 'off' ? 'hidden' : 'shown'}.` }
    }
    const b = await read($, board)
    if (b.kind !== 'ok') return { text: `Feature unknown: ${b.reason}.` }
    const dir = (await featureDir($)) ?? `specs/${b.feature}`
    if (!/^(T\d+|FR-\d+)$/i.test(arg)) return { text: 'Usage: /kanban T001 | FR-001 | on | off' }
    const id = arg.toUpperCase()
    const out: string[] = []
    for (const f of ['tasks.md', 'spec.md', 'plan.md', 'data-model.md', 'research.md']) {
      try {
        const lines = String(await $.fs.read(`${dir}/${f}`)).split('\n').filter(l => new RegExp(`\\b${id}\\b`).test(l))
        for (const l of lines.slice(0, 5)) out.push(`${f}: ${l.trim().slice(0, 300)}`)
      } catch {}
    }
    return { text: out.length ? out.join('\n') : `${id} not found in ${dir}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isActive)) || (await read($, isHidden))) return next(e)
    const b = await read($, board)
    const { Box, Text, Button } = $.ui.resolve(e)

    if (b.kind === 'unknown') {
      return (
        <Box>
          <Text dimColor>kanban: {b.reason}</Text>
        </Box>
      )
    }
    const open = b.tasks.filter(t => !t.done)
    const done = b.tasks.length - open.length
    const blocked = open.filter(t => t.blocked)
    const waiting = blocked.filter(t => t.blocked === 'decision')
    const doing = b.active ? [b.active] : []
    const backlog = open.filter(t => !t.blocked && t.id !== b.active).length
    const ids = (xs: string[]) => (xs.length ? ` ${xs.slice(0, 3).join(',')}${xs.length > 3 ? '…' : ''}` : '')

    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>{b.feature} · tasks.md · {done}/{b.tasks.length} done </Text>
          <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
        </Box>
        <Box>
          {barRuns({ done, doing: doing.length, blocked: blocked.length, backlog }, 40).map((r, i) => (
            <Text key={String(i)} color={COLOR[r.top]} backgroundColor={r.glyph === '▀' ? COLOR[r.bottom] : undefined}>
              {r.glyph.repeat(r.n)}
            </Text>
          ))}
        </Box>
        <Text>
          <Text color={COLOR.backlog}>░ Backlog {backlog}</Text> │ <Text color={COLOR.doing}>▒ In progress {doing.length}
          {ids(doing)}
          {b.activeFrom === 'inferred' ? ' (inferred)' : ''}
          {doing.length === 0 ? ' (none known)' : ''}</Text> │ <Text color={COLOR.blocked}>■ Blocked {blocked.length}
          {waiting.length ? ` (${waiting.length} awaiting decision)` : ''}
          {ids(blocked.map(t => t.id))}</Text> │ <Text color={COLOR.done}>█ Done {done}</Text>
        </Text>
      </Box>
    )
  })
}
