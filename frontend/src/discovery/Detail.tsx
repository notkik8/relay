import { useQueryClient } from '@tanstack/react-query'
import { ArrowDownRight, ArrowLeft, Bookmark, Check, ExternalLink, Link2, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { send } from '../api/client'
import type { Account } from '../api/types'
import { SaveToCollection } from '../components/PinCollections'
import { Avatar, Feedback, Modal } from '../components/UI'
import { displayTitle, kindNames, pinPath, topicNames, type Material } from './catalog'
import { MediaVisual } from './MaterialCard'
import type { Library } from './recommend'

export function Detail({ material, account, saved, hidden, audioRef, videoRef, onSave, onPlay, onBack, onLess }: {
  material: Material; account?: Account | null; saved: boolean; hidden: boolean; audioRef: RefObject<HTMLAudioElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  onSave: (item: Material) => void; onPlay: () => void; onBack: () => void; onLess: () => void
}) {
  const [shared, setShared] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [audioError, setAudioError] = useState(false)
  const [videoError, setVideoError] = useState(false)
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
        {material.video ? <video ref={videoRef} controls playsInline preload="metadata" src={material.video}
          poster={material.image ?? undefined} onPlay={onPlay} onError={() => setVideoError(true)} aria-label={`Воспроизвести ${title}`} />
          : <MediaVisual material={material} details />}
      </div>
      <div className="relay-detail-info">
        <p className="relay-detail-kind">{kindNames[material.kind]} {!material.author && <> <span aria-hidden="true">·</span> {topicNames[material.topic]}</>}</p>
        <h1 id="pin-title">{title}</h1>
        {material.author ? <Link className="relay-pin-author" to={`/u/${material.author.username}`}>
          <Avatar person={material.author} size="small" /><span>{material.author.name}</span>
        </Link> : (material.creator || material.year) && <p className="relay-detail-byline">
          {[material.creator, material.year].filter(Boolean).join(' · ')}
        </p>}
        {material.audio && <div className="relay-player">
          <audio ref={audioRef} controls preload="none" src={material.audio} onError={() => setAudioError(true)}
            onPlay={onPlay} aria-label={`Воспроизвести ${title}`} />
          {material.excerpt && !audioError && <p>Фрагмент записи · 35 с</p>}
          {audioError && <p role="status">{material.author ? 'Не удалось воспроизвести аудио.' : 'Запись можно открыть на странице источника.'}</p>}
        </div>}
        {material.description && material.description !== material.title && <p className="relay-detail-description">{material.description}</p>}
        {videoError && <p role="status">Не удалось воспроизвести видео.</p>}
        <div className="relay-detail-actions">
          <button type="button" className="relay-primary" aria-pressed={saved} onClick={() => onSave(material)}>
            {saved ? <Check size={16} /> : <Bookmark size={16} />}{saved ? 'Сохранено' : 'Сохранить'}
          </button>
          <SaveToCollection account={account} materialId={material.id} />
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
          {material.source && <a href={material.source} target="_blank" rel="noopener noreferrer">
            {material.author ? 'Оригинал' : 'Источник'} <ExternalLink size={13} />
          </a>}
          {material.license && (material.licenseUrl
            ? <a href={material.licenseUrl} target="_blank" rel="noopener noreferrer">{material.license}</a>
            : <span>{material.license}</span>)}
          {(material.credit || material.originalTitle) && <span className="relay-credit">
            {[material.originalTitle, material.credit].filter(Boolean).join(' · ')}
          </span>}
          {material.preview && <small>Миниатюра уменьшена. Оригинал доступен у источника.</small>}
        </div>
        {!hidden && <button type="button" className="relay-less" onClick={onLess}><ArrowDownRight size={17} /> Меньше такого</button>}
        {material.author && material.author.id === account?.id && <DeletePin id={material.id} onDeleted={onBack} />}
      </div>
    </article>
  </div>
}

function DeletePin({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const cache = useQueryClient()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  async function remove() {
    setPending(true)
    setError(undefined)
    try {
      await send(`/pins/${id}`, 'DELETE')
      onDeleted()
      for (const key of ['pins', 'pin', 'pin-collection', 'saved-pins']) {
        void cache.invalidateQueries({ queryKey: [key] })
      }
    } catch (cause) { setError(cause) }
    finally { setPending(false) }
  }
  return <>
    <button type="button" className="relay-less" onClick={() => setOpen(true)}><Trash2 size={16} /> Удалить пин</button>
    {open && <Modal title="Удалить пин?" onClose={() => setOpen(false)}>
      <div className="form-stack"><p>Пин исчезнет из ленты, профиля и папок.</p><Feedback error={error} />
        <button className="button danger" disabled={pending} onClick={() => void remove()}>Удалить пин</button></div>
    </Modal>}
  </>
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
