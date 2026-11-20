import { Bookmark, Film, Headphones, ImageOff, Pause, Play } from 'lucide-react'
import { memo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { displayTitle, hash, pinPath, type Material } from './catalog'

const featuredTone: Record<string, number> = { 'im-gymnopedie': 1, 'im-chill-wave': 4, 'im-bittersweet': 3, 'im-carefree': 2 }
const albumColors = [
  ['#263953', '#91a9bb', '#d8e7ef'], ['#282843', '#ae94dc', '#ece2fb'],
  ['#233e32', '#9ebc8d', '#eaf4dc'], ['#512d2b', '#de9878', '#fae1d2'],
  ['#222e30', '#7cb6a4', '#cce8e0'], ['#49342a', '#d5b283', '#f0dec0'],
]

export function MediaVisual({ material, eager = false, details = false }: {
  material: Material; eager?: boolean; details?: boolean
}) {
  const [failed, setFailed] = useState<string[]>([])
  const source = [details && material.author ? material.image : material.thumbnail, material.preview, material.image]
    .find((url) => url && !failed.includes(url))
  if (material.kind === 'track' && !source) {
    const [base, vinyl, text] = albumColors[featuredTone[material.id] ?? Math.floor(hash(material.id) * albumColors.length)]
    const style = { '--album-base': base, '--album-vinyl': vinyl, '--album-text': text } as CSSProperties
    return <div className="relay-album" style={style} aria-hidden="true">
      <span className="relay-disc" />
      <div className="relay-album-copy">
        <span>{material.creator || 'Музыка'}</span><strong>{displayTitle(material)}</strong></div>
      {!material.audio && !details && <span className="relay-album-mark"><Headphones size={17} /></span>}
    </div>
  }
  const label = displayTitle(material)
  return <div className={`relay-media relay-media-${material.topic}`}
    style={{ backgroundColor: material.placeholder }}>
    {source
      ? <img src={source} alt={details ? label : ''} draggable={false}
          loading={eager || details ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer"
          onError={() => setFailed((urls) => [...urls, source])} />
      : <div className="relay-media-fallback">
        {material.kind === 'video' ? <Film size={28} aria-hidden="true" /> : <>
          <ImageOff size={24} strokeWidth={1.5} aria-hidden="true" />
          {details && <span>Изображение недоступно</span>}
        </>}
      </div>}
  </div>
}

export const MaterialCard = memo(function MaterialCard({ material, saved, playing, eager, style, onSave, onOpen, onPreview }: {
  material: Material; saved: boolean; playing: boolean; eager?: boolean; style: CSSProperties
  onSave: (material: Material) => void; onOpen: (material: Material) => void; onPreview: (material: Material) => void
}) {
  const title = displayTitle(material)
  return <article className={`relay-card relay-card-kind-${material.kind}`} style={style} data-material={material.id}>
    <Link to={pinPath(material.id)} state={{ relayBack: true }} id={`pin-link-${material.id}`}
      className="relay-card-open" aria-label={`Открыть ${title}`} onClick={(event) => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onOpen(material)
      }}>
      <div className="relay-card-image">
        <MediaVisual material={material} eager={eager} />
        {(material.kind === 'film' || material.kind === 'video') && <span className="relay-film-badge">
          <Film size={13} /> {material.kind === 'video' ? 'Видео' : 'Кино'}
        </span>}
      </div>
      <div className="relay-card-caption">
        <strong>{title}</strong>
        {material.kind !== 'image' && <small>{[material.creator, material.year].filter(Boolean).join(' · ') ||
          (material.kind === 'film' ? 'Кинопостер' : material.kind === 'video' ? 'Видео' : 'Аудиозапись')}</small>}
      </div>
    </Link>
    {material.audio && <button type="button" className="relay-card-preview"
      aria-label={`${playing ? 'Остановить' : 'Послушать'} — ${title}`} onClick={() => onPreview(material)}>
      <span>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</span>
    </button>}
    <button type="button" className={`relay-card-save${saved ? ' is-saved' : ''}`} aria-pressed={saved}
      aria-label={`${saved ? 'Убрать из сохранённого' : 'Сохранить'} — ${title}`}
      onClick={() => onSave(material)} title={saved ? 'Убрать из сохранённого' : 'Сохранить'}>
      <Bookmark size={17} strokeWidth={2} fill={saved ? 'currentColor' : 'none'} />
    </button>
  </article>
})
