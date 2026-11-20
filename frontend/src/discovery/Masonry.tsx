import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useAttention } from './attention'
import { artRatio, type Material } from './catalog'
import { MaterialCard } from './MaterialCard'
import type { Signal } from './recommend'

export function Masonry({ items, featured, saved, playing, watch, onOpen, onSave, onPreview, onSignal, children }: {
  items: Material[]; saved: string[]; playing: string | null; watch: boolean
  featured?: ReactNode; children?: ReactNode
  onOpen: (material: Material) => void; onSave: (material: Material) => void
  onPreview: (material: Material) => void; onSignal: (material: Material, type: Signal) => void
}) {
  const surface = useRef<HTMLDivElement>(null)
  const feature = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState({ width: 0, columns: 2, gap: 12, sideColumns: 0, featureHeight: 0 })
  const hasFeature = Boolean(featured)
  useLayoutEffect(() => {
    const root = surface.current
    const pin = feature.current
    if (!root) return
    const size = () => {
      const style = getComputedStyle(root)
      const width = root.getBoundingClientRect().width
      const columns = Number(style.getPropertyValue('--relay-columns'))
      const gap = parseFloat(style.getPropertyValue('--relay-column-gap'))
      const sideColumns = Number(style.getPropertyValue('--relay-side-columns'))
      const featureHeight = pin?.getBoundingClientRect().height ?? 0
      setLayout((previous) => previous.width === width && previous.columns === columns && previous.gap === gap &&
        previous.sideColumns === sideColumns && previous.featureHeight === featureHeight
        ? previous : { width, columns, gap, sideColumns, featureHeight })
    }
    size()
    const observer = new ResizeObserver(size)
    observer.observe(root)
    if (pin) observer.observe(pin)
    return () => observer.disconnect()
  }, [hasFeature])
  const { width, columns, gap, sideColumns, featureHeight } = layout
  useAttention(surface, items, watch && width > 0, onSignal)
  const map = useMemo(() => {
    const columnWidth = Math.max(1, (width - gap * (columns - 1)) / columns)
    const belowPin = Array.from({ length: columns }, (_, column) =>
      hasFeature && column >= sideColumns && column < columns - sideColumns)
    const offsets = belowPin.map((below) => below ? featureHeight + gap : 0)
    const styles = items.map((material) => {
      const column = offsets.indexOf(Math.min(...offsets))
      const imageHeight = Math.round(columnWidth / artRatio(material))
      const captionHeight = material.kind === 'image' ? 44 : 60
      // The center cards start at the pin's live bottom edge, even while its height changes.
      const y = offsets[column] - (belowPin[column] ? featureHeight : 0)
      offsets[column] += imageHeight + captionHeight + gap
      return {
        width: columnWidth,
        gridRow: hasFeature ? (belowPin[column] ? '2 / 3' : '1 / 2') : undefined,
        transform: `translate(${column * (columnWidth + gap)}px, ${y}px)`,
        '--relay-image-height': `${imageHeight}px`,
        '--relay-caption-height': `${captionHeight}px`,
      } as CSSProperties
    })
    return { styles, height: items.length ? Math.max(...offsets) : featureHeight }
  }, [columns, featureHeight, gap, hasFeature, items, sideColumns, width])
  const marked = useMemo(() => new Set(saved), [saved])

  const cards = <>
    <div className="relay-masonry-space" style={{ height: map.height - featureHeight }} aria-hidden="true" />
    {width > 0 && items.map((material, index) => <MaterialCard key={material.id} material={material}
      saved={marked.has(material.id)} playing={playing === material.id} style={map.styles[index]} eager={index < 12}
      onOpen={onOpen} onSave={onSave} onPreview={onPreview} />)}
    {children}
  </>

  return <div ref={surface} className={hasFeature ? 'relay-masonry relay-masonry-pin' : 'relay-masonry'}>
    {hasFeature && <div className="relay-masonry-feature" ref={feature}>{featured}</div>}
    {hasFeature && items.length > 0 ? <section className="relay-related" aria-labelledby="related-title">
      <h2 id="related-title" className="visually-hidden">Похожие находки</h2>
      {cards}
    </section> : cards}
  </div>
}
