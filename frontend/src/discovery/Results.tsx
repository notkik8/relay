import { ArrowDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Material } from './catalog'
import { Masonry } from './Masonry'
import { recommendBatch, type Library, type Signal } from './recommend'

const pageSize = 34

export type ResultProgress = { ids: string[]; limit: number }

export function Results({ candidates, featured, ordered, eclectic, newest, seed, watch, live, saved, playing, history, historyKey,
  onProgress, onOpen, onSave, onPreview, onSignal }: {
  candidates: Material[]; featured?: ReactNode; ordered: boolean; eclectic: boolean; newest: Material[]; seed: number; watch: boolean
  live: RefObject<Library>; saved: string[]; playing: string | null
  history: RefObject<Map<string, ResultProgress>>; historyKey: string
  onProgress: (progress: ResultProgress) => void
  onOpen: (item: Material) => void; onSave: (item: Material) => void
  onPreview: (item: Material) => void; onSignal: (item: Material, type: Signal) => void
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(() => history.current.get(historyKey) ?? {
    ids: ordered ? [] : [...newest, ...recommendBatch(
      candidates.filter((candidate) => !newest.includes(candidate)), live.current, pageSize - newest.length, 0, eclectic, seed,
    )].map((item) => item.id),
    limit: pageSize,
  })
  const indexed = useMemo(() => new Map(candidates.map((item) => [item.id, item])), [candidates])
  const items = useMemo(() => ordered ? candidates.slice(0, progress.limit)
    : progress.ids.flatMap((id) => indexed.get(id) ?? []), [candidates, indexed, ordered, progress])
  const more = items.length < candidates.length

  useEffect(() => { onProgress(progress) }, [onProgress, progress])

  const append = useCallback(() => {
    setProgress((current) => {
      if (ordered) return { ...current, limit: Math.min(candidates.length, current.limit + pageSize) }
      const visible = new Set(current.ids)
      const pool = candidates.filter((item) => !visible.has(item.id))
      const next = recommendBatch(pool, live.current, pageSize, current.ids.length, eclectic, seed)
      return next.length ? { ...current, ids: [...current.ids, ...next.map((item) => item.id)] } : current
    })
  }, [candidates, ordered, eclectic, live, seed])

  useEffect(() => {
    const node = sentinel.current
    if (!node || !more || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      append()
    }, { rootMargin: '600px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [append, items.length, more])

  return <Masonry items={items} featured={featured} saved={saved} playing={playing} watch={watch}
    onOpen={onOpen} onSave={onSave} onPreview={onPreview} onSignal={onSignal}>
    {more && <div ref={sentinel} className="relay-more">
      <button className="relay-quiet" onClick={append}><ArrowDown size={16} /> Ещё материалы</button>
    </div>}
  </Masonry>
}
