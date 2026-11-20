import { useEffect, useRef, type RefObject } from 'react'
import type { Material } from './catalog'
import type { Signal } from './recommend'

type RecordSignal = (entry: Material, signal: Signal) => void

export function useAttention(
  root: RefObject<HTMLDivElement | null>, rows: Material[], enabled: boolean, onSignal: RecordSignal,
) {
  const history = useRef(new Map<string, { time: number; skipped: boolean; dwelled: boolean; hovered: boolean }>())
  const activeAt = useRef(performance.now())
  const signalRef = useRef(onSignal)
  useEffect(() => { signalRef.current = onSignal }, [onSignal])

  useEffect(() => {
    const surface = root.current
    if (!surface || !enabled || typeof IntersectionObserver === 'undefined') return
    const indexed = new Map(rows.map((entry) => [entry.id, entry]))
    const exposed = new Map<string, Material>()
    let hovered: { material: Material; since: number } | null = null
    let lastTick = performance.now()
    const state = (id: string) => {
      const item = history.current.get(id) ?? { time: 0, skipped: false, dwelled: false, hovered: false }
      history.current.set(id, item)
      return item
    }

    const viewport = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.material
        const material = id ? indexed.get(id) : undefined
        if (!material) continue
        if (entry.isIntersecting && entry.intersectionRatio >= .56) {
          exposed.set(material.id, material)
          continue
        }
        if (!exposed.delete(material.id)) continue
        const item = state(material.id)
        if (document.visibilityState === 'visible' && !item.skipped && !item.dwelled && !item.hovered &&
          item.time >= 350 && item.time < 1750) {
          item.skipped = true
          signalRef.current(material, 'glance')
        }
        item.time = 0
      }
    }, { threshold: [.56] })

    function active() { activeAt.current = performance.now() }
    function pointer(event: PointerEvent) {
      active()
      if (event.pointerType !== 'mouse') return
      const id = (event.target as HTMLElement).closest<HTMLElement>('[data-material]')?.dataset.material
      const material = id ? indexed.get(id) : undefined
      if (!material) { hovered = null; return }
      if (hovered?.material.id !== id) hovered = { material, since: performance.now() }
    }
    function pointerOut() { hovered = null }
    function visibility() {
      hovered = null
      lastTick = performance.now()
      if (document.visibilityState === 'visible') active()
    }

    const ticker = window.setInterval(() => {
      const now = performance.now()
      const elapsed = Math.min(now - lastTick, 550)
      lastTick = now
      if (document.visibilityState !== 'visible' || now - activeAt.current > 16_000) return
      if (hovered && exposed.has(hovered.material.id) && now - hovered.since >= 900) {
        const item = state(hovered.material.id)
        if (!item.hovered) {
          item.hovered = true
          signalRef.current(hovered.material, 'hover')
        }
      }
      for (const material of exposed.values()) {
        const item = state(material.id)
        item.time += elapsed
        if (!item.dwelled && item.time >= 4_000) {
          item.dwelled = true
          signalRef.current(material, 'dwell')
        }
      }
    }, 400)

    surface.querySelectorAll('[data-material]').forEach((element) => viewport.observe(element))
    surface.addEventListener('pointermove', pointer, { passive: true })
    surface.addEventListener('pointerleave', pointerOut)
    window.addEventListener('scroll', active, { passive: true })
    window.addEventListener('keydown', active)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      viewport.disconnect()
      window.clearInterval(ticker)
      surface.removeEventListener('pointermove', pointer)
      surface.removeEventListener('pointerleave', pointerOut)
      window.removeEventListener('scroll', active)
      window.removeEventListener('keydown', active)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [root, rows, enabled])
}
