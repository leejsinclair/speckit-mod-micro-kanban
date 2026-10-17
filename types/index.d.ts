export type Task = {
  id: string
  text: string
  done: boolean
  /** set only from an explicit marker in tasks.md */
  blocked: null | 'decision' | 'other'
  /** explicit [~] / [IN PROGRESS] marker in tasks.md */
  marked: boolean
}

export type Board =
  | { kind: 'unknown'; reason: string }
  | { kind: 'ok'; feature: string; tasks: Task[]; active: string | null; activeFrom: 'tasks.md' | 'inferred' | null }

declare module 'claude-code' {
  interface PluginState {
    'micro-kanban': { board: Board; isActive: boolean; isHidden: boolean }
  }
}
