import { ArrowUpRight, Film, Image, Layers3, LockKeyhole, Music2 } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Board, MediaKind, Person, Theme } from '../api/types'

import { visibilityLabels } from './format'

export function MediaIcon({ kind, size = 17 }: { kind: MediaKind; size?: number }) {
  const Icon = { track: Music2, film: Film, image: Image }[kind]
  return <Icon size={size} aria-hidden="true" />
}

export function Artwork({ url, theme = 'blue', kind, eager = false }: {
  url?: string | null; theme?: Theme; kind?: MediaKind; eager?: boolean
}) {
  return <div className={`artwork art-${theme}${kind ? ' media-art' : ''}`} aria-hidden="true">
    <div className="art-form" />
    {kind && <div className="art-icon"><MediaIcon kind={kind} size={34} /></div>}
    {url && <img key={url} src={url} alt="" loading={eager ? 'eager' : 'lazy'}
      onError={(event) => { event.currentTarget.hidden = true }} />}
  </div>
}

export function Avatar({ person, size = 'normal' }: {
  person: Pick<Person, 'name'> & Partial<Pick<Person, 'avatar_url'>>; size?: 'small' | 'normal' | 'large'
}) {
  const initials = person.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('')
  return <span className={`avatar avatar-${size}`} aria-hidden="true">
    {initials}
    {person.avatar_url && <img key={person.avatar_url} src={person.avatar_url} alt=""
      onError={(event) => { event.currentTarget.hidden = true }} />}
  </span>
}

function plural(value: number, words: string[]) {
  const units = value % 10
  const teens = value % 100
  return words[teens >= 11 && teens <= 14 ? 2 : units === 1 ? 0 : units >= 2 && units <= 4 ? 1 : 2]
}

export function Counts({ counts }: { counts: Board['counts'] }) {
  const words = {
    track: ['трек', 'трека', 'треков'],
    film: ['фильм', 'фильма', 'фильмов'],
    image: ['изображение', 'изображения', 'изображений'],
  }
  const entries = (Object.keys(words) as MediaKind[]).filter((kind) => counts[kind] > 0)
  return <span className="counts">{entries.length
    ? entries.map((kind) => `${counts[kind]} ${plural(counts[kind], words[kind])}`).join(' · ')
    : 'Пока пусто'}</span>
}

export function BoardCard({ board }: { board: Board }) {
  return <article className="board-card">
    <Link className="card-visual" to={`/b/${board.key}`} aria-label={board.title}>
      <Artwork theme={board.theme} url={board.cover_url} />
      {board.visibility !== 'public' && <span className="art-badge"><LockKeyhole size={13} />
        {visibilityLabels[board.visibility]}</span>}
      <span className="card-arrow"><ArrowUpRight size={18} /></span>
    </Link>
    <div className="card-caption">
      <h3><Link to={`/b/${board.key}`}>{board.title}</Link></h3>
      <Counts counts={board.counts} />
    </div>
    <Link className="card-author" to={`/u/${board.author.username}`}>{board.author.name}</Link>
  </article>
}

export function BoardGrid({ boards }: { boards: Board[] }) {
  return <div className="board-grid">{boards.map((board) => <BoardCard key={board.key} board={board} />)}</div>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty">
    <div className="empty-icon"><Layers3 size={26} /></div>
    <h3>{title}</h3>
    {children}
  </div>
}

export function Feedback({ error, children }: { error?: unknown; children?: ReactNode }) {
  if (error) return <p className="feedback error" role="alert">
    {error instanceof Error ? error.message : 'Произошла ошибка. Повторите попытку.'}
  </p>
  return children ? <p className="feedback" role="status">{children}</p> : null
}

export function Loading({ label = 'Загрузка…' }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" />{label}</div>
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [])
  return <dialog ref={dialog} className="sheet" aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="sheet-body">
      <div className="sheet-heading"><h2>{title}</h2><button className="button quiet" onClick={onClose}>Закрыть</button></div>
      {children}
    </div>
  </dialog>
}

export function Brand() {
  return <Link to="/" className="brand" aria-label="Relay — рекомендации">Relay</Link>
}
