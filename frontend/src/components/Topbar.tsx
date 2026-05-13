import { forwardRef } from 'react'

interface TopbarProps {
  title: string
  search: string
  onSearchChange: (value: string) => void
  onExport: () => void
  onNewTask: () => void
  onOpenAssistant: () => void
}

export const Topbar = forwardRef<HTMLInputElement, TopbarProps>(function Topbar(
  { title, search, onSearchChange, onExport, onNewTask, onOpenAssistant },
  ref,
) {
  return (
    <div className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="search-box">
        <span style={{ fontSize: 14, color: 'var(--text3)' }}>🔍</span>
        <input
          ref={ref}
          type="text"
          placeholder="Search tasks…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <button
        className="topbar-btn btn-assistant"
        onClick={onOpenAssistant}
        title="Voice / AI assistant"
      >
        🎙 AI
      </button>
      <button className="topbar-btn btn-ghost" onClick={onExport}>
        ⬇ Export
      </button>
      <button className="topbar-btn btn-primary" onClick={onNewTask}>
        + New Task
      </button>
    </div>
  )
})
