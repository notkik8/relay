import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

export function Notice({ notice, onUndo, onDismiss }: {
  notice: { text: string; undo: boolean }
  onUndo: () => void; onDismiss: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (hovered || focused) return
    const timer = window.setTimeout(onDismiss, notice.undo ? 10000 : 3500)
    return () => window.clearTimeout(timer)
  }, [focused, hovered, notice, onDismiss])

  return <aside className="relay-notice" aria-label="Уведомление"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
    }}>
    <p role="status">{notice.text}</p>
    {notice.undo && <button type="button" onClick={onUndo}>Отменить</button>}
    <button type="button" className="relay-notice-close" aria-label="Закрыть уведомление" onClick={onDismiss}><X size={17} /></button>
  </aside>
}
