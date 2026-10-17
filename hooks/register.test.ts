import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/proj'
const TASKS = `- [X] T001 done
- [~] T002 working
- [ ] T003 [BLOCKED: needs decision on name]
- [ ] T004 later
`

type World = { files: Record<string, string>; branch: string }

// A project in memory: the files, and the git answers the mod asks for.
function world(on: On, w: World) {
  on('fs.read', async ($, e) => {
    const text = w.files[e.path]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.exists', async ($, e) => ({ value: e.path in w.files }))
  on('process.run', async ($, e) => {
    const stdout = e.argv.includes('--show-toplevel') ? ROOT : e.argv.includes('--abbrev-ref') ? w.branch : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', async () => ({ value: { command: 'kanban' } }))
  // What sits beneath the plugin in a session: the prompt enters as typed, the band is empty until the mod draws.
  on('prompt.submit', async ($, e) => ({ text: e.text }))
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as any)
  on('tool.call', async () => ({ result: { text: 'ok' } }) as any)
  on('session.start', async () => ({ cwd: ROOT }))
}

const band = { hasSurvey: false, isWorking: false } as any
const mountBand = ($: any) => $.ui.mount({ plugin: 'micro-kanban', surface: 'terminal', component: 'AbovePrompt', props: band })
// The drawn tree as the text a person reads: strings of every element, in order.
const plain = (n: any): string => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(plain).join('') : n?.children ? plain(n.children) : '')
const shown = async (ui: any) => plain(await ui.drawn())
const implement = ($: any) => $.prompt.submit({ text: '/speckit-implement' })
const kanban = ($: any, args: string) => $.command.run({ command: 'kanban', args, origin: 'composer' })

const FEATURE = { [`${ROOT}/.specify/feature.json`]: JSON.stringify({ feature_directory: 'specs/003-demo' }), [`${ROOT}/specs/003-demo/tasks.md`]: TASKS }

test('draws nothing until /speckit-implement is submitted', async ($, on) => {
  world(on, { files: FEATURE, branch: 'main' })
  const ui = await mountBand($)
  expect(await shown(ui)).not.toContain('Backlog')
  await $.prompt.submit({ text: 'hello' })
  expect(await shown(await mountBand($))).not.toContain('Backlog')
})

test('shows the board with counts after /speckit-implement', async ($, on) => {
  world(on, { files: FEATURE, branch: 'main' })
  await implement($)
  const s = await shown(await mountBand($))
  expect(s).toContain('003-demo')
  expect(s).toContain('1/4 done')
  expect(s).toContain('Backlog 1')
  expect(s).toContain('In progress 1')
  expect(s).toContain('Blocked 1')
  expect(s).toContain('awaiting decision')
  expect(s).toContain('Done 1')
})

test('finds the feature from the branch name when feature.json is absent', async ($, on) => {
  world(on, { files: { [`${ROOT}/specs/004-branchy/tasks.md`]: TASKS }, branch: '004-branchy' })
  await implement($)
  expect(await shown(await mountBand($))).toContain('004-branchy')
})

test('says why when the feature cannot be found', async ($, on) => {
  world(on, { files: {}, branch: 'main' })
  await implement($)
  expect(await shown(await mountBand($))).toContain('feature not determined')
})

test('says why when tasks.md has no tasks', async ($, on) => {
  world(on, { files: { ...FEATURE, [`${ROOT}/specs/003-demo/tasks.md`]: '# nothing here' }, branch: 'main' })
  await implement($)
  expect(await shown(await mountBand($))).toContain('no tasks found')
})

test('says why when tasks.md is unreadable', async ($, on) => {
  const files = { ...FEATURE }
  delete files[`${ROOT}/specs/003-demo/tasks.md`]
  world(on, { files, branch: 'main' })
  await implement($)
  expect(await shown(await mountBand($))).toContain('unreadable')
})

test('redraws on the next tick when tasks.md changes', async ($, on) => {
  const w = { files: { ...FEATURE }, branch: 'main' }
  world(on, w)
  const clock = mock.clock(on)
  await $.session.start({ cwd: ROOT } as any)
  await implement($)
  const ui = await mountBand($)
  expect(await shown(ui)).toContain('1/4 done')
  w.files[`${ROOT}/specs/003-demo/tasks.md`] = TASKS.replace('- [~] T002', '- [X] T002')
  await clock.advance(2000)
  expect(await shown(ui)).toContain('2/4 done')
})

test('the Hide button hides the board and /kanban on shows it again', async ($, on) => {
  world(on, { files: FEATURE, branch: 'main' })
  await implement($)
  const ui = await mountBand($)
  await ui.press({ key: 'hide' })
  expect(await shown(ui)).not.toContain('Backlog')
  const r = await kanban($, 'on')
  expect(r.text).toBe('Board shown.')
  expect(await shown(ui)).toContain('Backlog')
})

test('/kanban off hides the board', async ($, on) => {
  world(on, { files: FEATURE, branch: 'main' })
  await implement($)
  const ui = await mountBand($)
  expect((await kanban($, 'off')).text).toBe('Board hidden.')
  expect(await shown(ui)).not.toContain('Backlog')
})

test('submitting /speckit-implement again shows a hidden board', async ($, on) => {
  world(on, { files: FEATURE, branch: 'main' })
  await implement($)
  const ui = await mountBand($)
  await kanban($, 'off')
  await implement($)
  expect(await shown(ui)).toContain('Backlog')
})

test('/kanban T001 prints the lines that mention it, tagged by file', async ($, on) => {
  world(on, {
    files: { ...FEATURE, [`${ROOT}/specs/003-demo/spec.md`]: 'intro\nT001 is the first task\nother' },
    branch: 'main',
  })
  await implement($)
  const r = await kanban($, 't001')
  expect(r.text).toContain('tasks.md: - [X] T001 done')
  expect(r.text).toContain('spec.md: T001 is the first task')
  expect(r.text).not.toContain('T002')
})

test('/kanban FR-001 looks the requirement up', async ($, on) => {
  world(on, { files: { ...FEATURE, [`${ROOT}/specs/003-demo/spec.md`]: 'FR-001: must work\nFR-0011: not it' }, branch: 'main' })
  await implement($)
  const r = await kanban($, 'FR-001')
  expect(r.text).toBe('spec.md: FR-001: must work')
})

test('/kanban reports an id that is nowhere, bad usage, and an unknown feature', async ($, on) => {
  world(on, { files: FEATURE, branch: 'main' })
  await implement($)
  expect((await kanban($, 'T999')).text).toContain('T999 not found')
  expect((await kanban($, 'nonsense')).text).toContain('Usage: /kanban')
})

test('/kanban with no known feature says so', async ($, on) => {
  world(on, { files: {}, branch: 'main' })
  await implement($)
  expect((await kanban($, 'T001')).text).toContain('Feature unknown')
})

test('an unfinished tool call names the active task when nothing is marked', async ($, on) => {
  const files = { ...FEATURE, [`${ROOT}/specs/003-demo/tasks.md`]: '- [X] T001 a\n- [ ] T002 edit `src/x/y.ts`\n- [ ] T003 later\n' }
  world(on, { files, branch: 'main' })
  await implement($)
  await $.tool.call({ tool: 'Edit', input: { file_path: 'src/x/y.ts' } } as any)
  const s = await shown(await mountBand($))
  expect(s).toContain('T002')
  expect(s).toContain('(inferred)')
})
