import { mediaLabels } from './format'
import { ArrowDown, ArrowUp, ArrowUpRight, Bookmark, Grip, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import type { PointerEvent } from 'react'
import type { Item } from '../api/types'
import { LikeButton } from './BoardActions'
import { Artwork, MediaIcon } from './UI'

export function ItemCard({ item, path, index, total, editing, movable, authenticated, playing,
  onPlay, onImage, onEdit, onDelete, onDestination, onReorder, onDrag, onLike }: {
  item: Item; path: string; index: number; total: number; editing: boolean; movable: boolean;
  authenticated: boolean; playing: boolean; onPlay: () => void; onImage: () => void;
  onEdit: () => void; onDelete: () => void; onDestination: (mode: 'save' | 'move') => void;
  onReorder: (index: number) => void; onDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onLike: () => Promise<unknown>
}) {
  const cover = <Artwork kind={item.kind} theme={{ track: 'blue', film: 'violet', image: 'moss' }[item.kind] as 'blue' | 'violet' | 'moss'} url={item.artwork} />
  return <article className="item-card" data-item={item.id} data-index={index} id={`item-${item.id}`}>
    <div className="item-art">
      {item.original ? <button className="image-button" onClick={onImage} aria-label={`Открыть изображение ${item.title}`}>{cover}</button> : cover}
      <div className="art-badge"><MediaIcon kind={item.kind} size={15} /> {mediaLabels[item.kind]}</div>
      {item.preview && <button className="play-button" type="button" onClick={onPlay}
        aria-label={playing ? `Приостановить ${item.title}` : `Воспроизвести ${item.title}`}>
        {playing ? <Pause size={24} fill="currentColor" /> : <Play size={23} fill="currentColor" />}
      </button>}
      {editing && movable && <button className="drag-handle" title="Перетащить" aria-label="Перетащить"
        onPointerDown={onDrag} tabIndex={-1}><Grip size={19} /></button>}
    </div>
    <div className="item-body">
      <h3>{item.title}</h3>
      {(item.creator || item.year) && <p className="muted">{[item.creator, item.year].filter(Boolean).join(' · ')}</p>}
      {item.kind === 'track' && !item.preview && <small className="muted">Фрагмент недоступен</small>}
      {item.note && <p className="item-note">{item.note}</p>}
      {item.tags.length > 0 && <div className="tag-list">{item.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}</div>}
      <div className="item-actions">
        <LikeButton path={path} liked={item.liked} count={item.likes} onChange={onLike} />
        {authenticated && !editing && <button className="icon-button" title="Сохранить в подборку" aria-label="Сохранить в подборку"
          onClick={() => onDestination('save')}><Bookmark size={18} /></button>}
        {item.source && <a href={item.source} className="icon-button source-link" target="_blank" rel="noreferrer"
          title="Открыть источник" aria-label={`Источник для ${item.title}`}><ArrowUpRight size={18} /></a>}
      </div>
      {editing && <div className="edit-actions">
        <button className="icon-button" title="Раньше" aria-label="Раньше" disabled={!movable || index === 0}
          onClick={() => onReorder(index - 1)}><ArrowUp size={17} /></button>
        <button className="icon-button" title="Позже" aria-label="Позже" disabled={!movable || index + 1 >= total}
          onClick={() => onReorder(index + 1)}><ArrowDown size={17} /></button>
        <button className="icon-button" title="Заметка и теги" aria-label="Заметка и теги"
          onClick={onEdit}><Pencil size={16} /></button>
        <button className="button quiet" onClick={() => onDestination('move')}>Перенести</button>
        <button className="icon-button danger-text" title="Удалить элемент" aria-label="Удалить элемент"
          onClick={onDelete}><Trash2 size={16} /></button>
      </div>}
    </div>
  </article>
}
