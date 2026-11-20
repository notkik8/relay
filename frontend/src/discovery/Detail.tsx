import { ArrowDownRight, ArrowLeft, Bookmark, Check, ExternalLink, Link2, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { displayTitle, kindNames, pinPath, topicNames, type Material } from './catalog'
import { MediaVisual } from './MaterialCard'
import type { Library } from './recommend'

export function Detail({ material, saved, hidden, audioRef, onSave, onPlay, onBack, onLess }: {
  material: Material; saved: boolean; hidden: boolean; audioRef: RefObject<HTMLAudioElement | null>
  onSave: (item: Material) => void; onPlay: () => void; onBack: () => void; onLess: () => void
}) {
  const [shared, setShared] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [audioError, setAudioError] = useState(false)
  const title = displayTitle(material)
  const ratio = material.kind === 'track' ? 1.27 : Math.min(2.4, Math.max(.45, material.ratio))
  const share = async () => {
    const url = new URL(pinPath(material.id), window.location.origin).href
    try { await navigator.clipboard.writeText(url); setShared(true) }
    catch { setShareUrl(url) }
  }

  return <div className="relay-pin">
    <button type="button" className="relay-back" onClick={onBack}><ArrowLeft size={18} /> Назад</button>
    <article className={ratio < 1 ? 'relay-detail-grid relay-detail-portrait' : 'relay-detail-grid'} aria-labelledby="pin-title">
      <div className="relay-detail-art" style={{ '--relay-detail-ratio': ratio } as CSSProperties}>
        <MediaVisual material={material} details />
      </div>
      <div className="relay-detail-info">
        <p className="relay-detail-kind">{kindNames[material.kind]} <span aria-hidden="true">·</span> {topicNames[material.topic]}</p>
        <h1 id="pin-title">{title}</h1>
        {(material.creator || material.year) && <p className="relay-detail-byline">
          {[material.creator, material.year].filter(Boolean).join(' · ')}
        </p>}
        {material.audio && <div className="relay-player">
          <audio ref={audioRef} controls preload="none" src={material.audio} onError={() => setAudioError(true)}
            onPlay={onPlay} aria-label={`Воспроизвести ${title}`} />
          {material.excerpt && !audioError && <p>Фрагмент записи · 35 с</p>}
          {audioError && <p role="status">Запись можно открыть на странице источника.</p>}
        </div>}
        {material.description && material.description !== material.title && <p className="relay-detail-description">{material.description}</p>}
        <div className="relay-detail-actions">
          <button type="button" className="relay-primary" aria-pressed={saved} onClick={() => onSave(material)}>
            {saved ? <Check size={16} /> : <Bookmark size={16} />}{saved ? 'Сохранено' : 'Сохранить'}
          </button>
          <button type="button" className="relay-quiet" onClick={() => void share()}>
            {shared ? <Check size={16} /> : <Link2 size={16} />}{shared ? 'Скопировано' : 'Копировать ссылку'}
          </button>
          <span className="visually-hidden" role="status">{shared ? 'Ссылка скопирована' : ''}</span>
        </div>
        {shareUrl && <input className="relay-share-url" readOnly value={shareUrl} aria-label="Ссылка на материал"
          onFocus={(event) => event.currentTarget.select()} />}
      </div>
      <div className="relay-detail-footer">
        {!!material.tags.length && <div className="relay-detail-tags">
          {material.tags.slice(0, 6).map((tag) => <Link className="relay-chip" key={tag}
            to={`/?${new URLSearchParams({ q: tag })}`}>{tag}</Link>)}
        </div>}
        <div className="relay-license">
          <a href={material.source} target="_blank" rel="noopener noreferrer">Источник <ExternalLink size={13} /></a>
          {material.licenseUrl
            ? <a href={material.licenseUrl} target="_blank" rel="noopener noreferrer">{material.license}</a>
            : <span>{material.license}</span>}
          {(material.credit || material.originalTitle) && <span className="relay-credit">
            {[material.originalTitle, material.credit].filter(Boolean).join(' · ')}
          </span>}
          {material.preview && <small>Миниатюра уменьшена. Оригинал доступен у источника.</small>}
        </div>
        {!hidden && <button type="button" className="relay-less" onClick={onLess}><ArrowDownRight size={17} /> Меньше такого</button>}
      </div>
    </article>
  </div>
}

export function Preferences({ library, onClose, onToggle, onReset }: {
  library: Library; onClose: () => void; onToggle: () => void; onReset: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const sheet = dialog.current
    sheet?.showModal()
    return () => { sheet?.close() }
  }, [])

  return <dialog ref={dialog} aria-labelledby="preferences-title" className="relay-sheet relay-preferences"
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <div className="relay-sheet-content">
      <div className="relay-preferences-head">
        <h2 id="preferences-title">Настройки ленты</h2>
        <button type="button" className="relay-icon" onClick={onClose} aria-label="Закрыть"><X size={21} /></button>
      </div>
      <label className="relay-switch-row">
        <span><strong>Персональные рекомендации</strong>
          <small>Учитывают время на карточке, наведение, открытия, воспроизведение и сохранения.</small></span>
        <input type="checkbox" checked={library.personalize} onChange={onToggle} />
      </label>
      <p>Предпочтения хранятся в этом браузере.</p>
      <button type="button" className="relay-quiet" onClick={onReset}>Сбросить предпочтения</button>
    </div>
  </dialog>
}
