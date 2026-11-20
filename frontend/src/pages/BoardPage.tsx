import { tagsFrom, visibilityLabels } from '../components/format'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, Check, Eye, Flag, Link2, LockKeyhole, Pencil, Plus, Settings2, Share2, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, send, upload } from '../api/client'
import { useSession } from '../api/queries'
import type { Board, BoardItems, Item, MediaKind } from '../api/types'
import { Comments, DestinationDialog, LikeButton, Members, ReportDialog } from '../components/BoardActions'
import { AddMedia, BoardForm, FileForm } from '../components/BoardForms'
import { ItemCard } from '../components/ItemCard'
import { Artwork, Avatar, Counts, Empty, Feedback, Loading, MediaIcon, Modal } from '../components/UI'

type Dialog =
  | { type: 'add' | 'settings' | 'delete-board' }
  | { type: 'image' | 'edit' | 'delete-item' | 'save' | 'move'; item: Item }
  | { type: 'report'; target: { kind: 'board' | 'comment'; id: string } }

const kinds: Record<MediaKind, string> = { track: 'Треки', film: 'Фильмы', image: 'Изображения' }

export function NewBoardPage() {
  const session = useSession()
  const cache = useQueryClient()
  const navigate = useNavigate()
  if (session.isPending) return <Loading />
  if (!session.data) return <Navigate to="/login?next=%2Fnew" replace />
  return <div className="form-page">
    <Link to="/mine" className="back-link"><ArrowLeft size={16} /> Мои подборки</Link>
    <section className="panel">
      <span className="subtle-label"><LockKeyhole size={16} /> Приватная</span>
      <h1>Новая подборка</h1>
      <p className="muted">Начните с названия, затем добавьте материалы.</p>
      <BoardForm action="Создать подборку" onSave={async (data) => {
        const board = await send<Board>('/boards', 'POST', data)
        cache.setQueryData(['board', board.key], board)
        void cache.invalidateQueries({ queryKey: ['feed'] })
        navigate(`/b/${board.key}/edit`, { replace: true })
      }} />
    </section>
  </div>
}

export function BoardRoute({ editing = false }: { editing?: boolean }) {
  const { key = '' } = useParams()
  return <BoardPage key={`${key}-${editing}`} boardKey={key} editing={editing} />
}

function BoardPage({ boardKey, editing }: { boardKey: string; editing: boolean }) {
  const session = useSession()
  const user = session.data
  const cache = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [kind, setKind] = useState<MediaKind | ''>('')
  const [tag, setTag] = useState('')
  const [dialog, setDialog] = useState<Dialog>()
  const [message, setMessage] = useState('')
  const [error, setError] = useState<unknown>()
  const [reordering, setReordering] = useState(false)
  const [playing, setPlaying] = useState<string>()
  const audio = useRef<HTMLAudioElement>(null)
  const drag = useRef<{ card: HTMLElement; target?: HTMLElement; x: number; y: number; moved: boolean }>(null)
  const path = `/boards/${boardKey}`
  const boardQuery = useQuery({
    queryKey: ['board', boardKey],
    queryFn: ({ signal }) => api<Board>(path, { signal }),
    retry: false,
  })
  const items = useInfiniteQuery({
    queryKey: ['items', boardKey, kind, tag],
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ offset: String(pageParam) })
      if (kind) params.set('kind', kind)
      if (tag) params.set('tag', tag)
      return api<BoardItems>(`${path}/items?${params}`, { signal })
    },
    enabled: !boardQuery.isError,
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    retry: false,
  })
  const entries = items.data?.pages.flatMap((page) => page.items) ?? []
  const board = boardQuery.data
  const { isFetching, hasNextPage, fetchNextPage } = items
  const target = location.hash.slice(1)
  useEffect(() => {
    if (!target || isFetching) return
    const element = document.getElementById(target)
    if (element) element.scrollIntoView({ block: 'center' })
    else if (target.startsWith('item-') && hasNextPage) void fetchNextPage()
  }, [target, isFetching, hasNextPage, fetchNextPage])
  useEffect(() => {
    if (!target.startsWith('comment-')) return
    const observer = new MutationObserver(() => {
      const element = document.getElementById(target)
      if (element) {
        element.scrollIntoView({ block: 'center' })
        observer.disconnect()
      }
    })
    const element = document.getElementById(target)
    if (element) element.scrollIntoView({ block: 'center' })
    else observer.observe(document.getElementById('main') ?? document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [target])

  if (boardQuery.isPending) return <Loading label="Загружаем подборку…" />
  if (boardQuery.isError || !board) return <Empty title="Подборка недоступна">
    <Feedback error={boardQuery.error} /><Link className="button" to="/">К рекомендациям</Link>
  </Empty>
  if (editing && !board.editable) return <Navigate to={`/b/${board.key}`} replace />

  const total = Object.values(board.counts).reduce((sum, count) => sum + count, 0)
  const version = items.data?.pages[0]?.version
  const movable = editing && !kind && !tag && !reordering && version !== undefined &&
    items.data?.pages.every((page) => page.version === version)

  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ['board'] }),
      cache.invalidateQueries({ queryKey: ['items'] }),
      cache.invalidateQueries({ queryKey: ['feed'] }),
      cache.invalidateQueries({ queryKey: ['profile'] }),
    ])
  }

  async function reorder(item: Item, index: number) {
    if (!movable) return
    setReordering(true)
    setMessage('')
    setError(undefined)
    try {
      await send(`${path}/order`, 'PUT', { item_id: item.id, position: index, version })
      await refresh()
      setMessage(`«${item.title}» · позиция ${index + 1}`)
    } catch (cause) { setError(cause); await items.refetch() }
    finally { setReordering(false) }
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!movable || event.button !== 0) return
    const card = event.currentTarget.closest<HTMLElement>('[data-item]')
    if (!card) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { card, x: event.clientX, y: event.clientY, moved: false }
  }

  function updateDrag(event: PointerEvent) {
    const active = drag.current
    if (!active) return
    const x = event.clientX - active.x
    const y = event.clientY - active.y
    if (!active.moved && Math.hypot(x, y) < 9) return
    active.moved = true
    active.card.classList.add('dragging')
    active.card.style.transform = `translate3d(${x}px,${y}px,0)`
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-item]')
    if (target !== active.target) {
      active.target?.classList.remove('drop-target')
      active.target = target ?? undefined
      active.target?.classList.add('drop-target')
    }
  }

  function endDrag(commit: boolean) {
    const active = drag.current
    if (!active) return
    drag.current = null
    active.card.classList.remove('dragging')
    active.card.style.removeProperty('transform')
    active.target?.classList.remove('drop-target')
    if (commit && active.target?.dataset.index) {
      const item = entries.find((value) => value.id === active.card.dataset.item)
      if (item) void reorder(item, Number(active.target.dataset.index))
    }
  }

  function play(item: Item) {
    const player = audio.current
    if (!player || !item.preview) return
    setError(undefined)
    if (playing === item.id) { player.pause(); setPlaying(undefined); return }
    player.pause()
    player.src = item.preview
    setPlaying(item.id)
    void player.play().catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setPlaying(undefined)
      setError(new Error('Фрагмент недоступен. Откройте трек в каталоге.'))
    })
  }

  async function share() {
    if (!board) return
    const url = new URL(`/b/${board.key}`, window.location.origin).href
    setError(undefined)
    try {
      await navigator.clipboard.writeText(url)
      setMessage('Ссылка скопирована')
    } catch { setMessage(url) }
  }

  const close = () => setDialog(undefined)

  return <div className="board-page">
    <Link to={editing ? `/b/${board.key}` : '/collections'} className="back-link"><ArrowLeft size={16} />
      {editing ? 'Смотреть подборку' : 'Все подборки'}</Link>
    <section className="board-header">
      <div className="board-cover"><Artwork theme={board.theme} url={board.cover_url} eager /></div>
      <div className="board-heading">
        <div className="subtle-label">
          {board.visibility === 'private' ? <LockKeyhole size={15} /> : board.visibility === 'link' ? <Link2 size={15} /> : <Eye size={16} />}
          {visibilityLabels[board.visibility]}
        </div>
        <h1>{board.title}</h1>
        <div className="board-byline"><Link to={`/u/${board.author.username}`}>
          <Avatar person={board.author} size="small" /> {board.author.name}</Link><Counts counts={board.counts} /></div>
        {board.description && <p>{board.description}</p>}
        {board.tags.length > 0 && <div className="tag-list">{board.tags.map((value) =>
          <Link className="tag" to={`/search?q=${encodeURIComponent('#' + value)}`} key={value}>#{value}</Link>)}</div>}
        <div className="inline-actions board-controls">
          {editing ? <>
            <button className="button primary" onClick={() => setDialog({ type: 'add' })}><Plus size={18} /> Добавить</button>
            {board.owned && <button className="button" onClick={() => setDialog({ type: 'settings' })}><Settings2 size={17} /> Настройки</button>}
          </> : <>
            {board.visibility !== 'private' && <button className="button primary" onClick={() => void share()}><Share2 size={17} /> Поделиться</button>}
            <LikeButton path={path} count={board.likes} liked={board.liked} onChange={refresh} />
            {board.editable && <Link className="button" to={`/b/${board.key}/edit`}><Pencil size={16} /> Редактировать</Link>}
            {user && !board.owned && <button className="icon-button" title="Пожаловаться"
              aria-label="Пожаловаться на подборку" onClick={() => setDialog({ type: 'report', target: { kind: 'board', id: board.key } })}>
              <Flag size={18} /></button>}
          </>}
        </div>
      </div>
    </section>
    <Feedback error={error}>{message}</Feedback>
    <section aria-labelledby="board-contents">
      <div className="section-heading"><h2 id="board-contents">На доске <span className="number">{total}</span></h2></div>
      <div className="board-filters">
        <div className="segmented" aria-label="Тип элементов">
          <button aria-pressed={!kind} onClick={() => setKind('')}>Все</button>
          {(Object.keys(kinds) as MediaKind[]).map((value) =>
            <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}><MediaIcon kind={value} />{kinds[value]}</button>)}
        </div>
        {!!items.data?.pages[0]?.tags.length && <label className="tag-select"><span className="visually-hidden">Фильтр по тегу</span>
          <select value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="">Все теги</option>
            {items.data.pages[0].tags.map((value) => <option key={value} value={value}>#{value}</option>)}
          </select></label>}
      </div>
      {editing && (kind || tag) && <p className="muted filter-note">Для перестановки покажите всю доску.{' '}
        <button className="text-button" onClick={() => { setKind(''); setTag('') }}>Сбросить фильтры</button></p>}
      {items.isPending && <Loading label="Загружаем элементы…" />}
      <Feedback error={items.error} />
      {items.isSuccess && !entries.length && <Empty title={kind || tag ? 'По фильтру ничего нет' : 'На доске пока пусто'}>
        {editing && !kind && !tag && <button className="button primary" onClick={() => setDialog({ type: 'add' })}>
          <Plus size={18} /> Добавить первый элемент</button>}
      </Empty>}
      <div className="items-grid" onPointerMove={updateDrag} onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)} onLostPointerCapture={() => endDrag(false)}>
        {entries.map((item, index) => <ItemCard key={item.id} item={item} path={`${path}/items/${item.id}`}
          index={index} total={total} editing={editing} movable={!!movable} authenticated={!!user} playing={playing === item.id}
          onPlay={() => play(item)} onLike={() => items.refetch()} onImage={() => setDialog({ type: 'image', item })}
          onEdit={() => setDialog({ type: 'edit', item })} onDelete={() => setDialog({ type: 'delete-item', item })}
          onDestination={(type) => setDialog({ type, item })} onReorder={(next) => void reorder(item, next)} onDrag={startDrag} />)}
      </div>
      {items.hasNextPage && <div className="more"><button className="button" disabled={items.isFetchingNextPage}
        onClick={() => void items.fetchNextPage()}><ArrowDown size={17} /> Ещё элементы</button></div>}
    </section>
    {!editing && <Comments board={board} onReport={(id) => setDialog({ type: 'report', target: { kind: 'comment', id } })} />}
    <audio ref={audio} onEnded={() => setPlaying(undefined)} />
    {dialog?.type === 'add' && <Modal title="Добавить на доску" onClose={close}><AddMedia boardKey={boardKey} onAdded={refresh} /></Modal>}
    {dialog?.type === 'settings' && <Modal title="Настройки подборки" onClose={close}>
      <div className="form-stack settings">
        <BoardForm initial={board} onSave={async (data) => {
          const updated = await send<Board>(path, 'PUT', data)
          cache.setQueryData(['board', updated.key], updated)
          if (updated.key !== boardKey) navigate(`/b/${updated.key}/edit`, { replace: true })
          close()
          await refresh()
          setMessage('Настройки сохранены')
        }} />
        <section className="form-stack">
          <h3>Обложка</h3>
          <FileForm label="Изображение обложки" action="Загрузить обложку" onUpload={async (file) => {
            await upload(`${path}/cover`, 'PUT', file); await refresh()
          }} />
          {board.cover_url && <button className="button" onClick={async () => {
            try { await send(`${path}/cover`, 'DELETE'); await refresh() }
            catch (cause) { setError(cause); close() }
          }}>Убрать изображение обложки</button>}
        </section>
        <Members boardKey={boardKey} />
        <button className="button danger-text" onClick={() => setDialog({ type: 'delete-board' })}><Trash2 size={17} /> Удалить подборку</button>
      </div>
    </Modal>}
    {dialog?.type === 'edit' && <Modal title="Заметка и теги" onClose={close}>
      <ItemForm item={dialog.item} total={movable ? total : 0} index={entries.findIndex((item) => item.id === dialog.item.id)}
        onSave={async (item, note, tags, position) => {
          await send(`${path}/items/${item.id}`, 'PUT', { note, tags })
          if (position !== undefined) await reorder(item, position)
          close()
          await refresh()
        }} />
    </Modal>}
    {dialog?.type === 'image' && <Modal title={dialog.item.title} onClose={close}>
      <img className="lightbox-image" src={dialog.item.original ?? undefined} alt={dialog.item.title} />
    </Modal>}
    {dialog?.type === 'report' && <ReportDialog board={board} target={dialog.target} onClose={close} />}
    {(dialog?.type === 'save' || dialog?.type === 'move') && <DestinationDialog board={board}
      item={dialog.item} mode={dialog.type} onClose={close} onChange={refresh} />}
    {dialog?.type === 'delete-item' && <ConfirmDelete title={`Удалить «${dialog.item.title}»?`} onClose={close}
      onDelete={async () => { await send(`${path}/items/${dialog.item.id}`, 'DELETE'); close(); await refresh() }} />}
    {dialog?.type === 'delete-board' && <ConfirmDelete title={`Удалить «${board.title}»?`} onClose={close}
      onDelete={async () => { await send(path, 'DELETE'); navigate('/mine', { replace: true }); await refresh() }} />}
  </div>
}

function ItemForm({ item, total, index, onSave }: {
  item: Item; total: number; index: number; onSave: (item: Item, note: string, tags: string[], position?: number) => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  return <form className="form-stack" onSubmit={async (event) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const position = data.has('position') ? Number(data.get('position')) - 1 : undefined
    setPending(true)
    setError(undefined)
    try {
      await onSave(item, String(data.get('note')).trim(), tagsFrom(String(data.get('tags'))),
        position === index ? undefined : position)
    } catch (cause) { setError(cause) }
    finally { setPending(false) }
  }}>
    <label>Заметка<textarea name="note" rows={4} maxLength={1500} defaultValue={item.note} /></label>
    <label>Теги<input name="tags" defaultValue={item.tags.join(', ')} /><small>Разделяйте теги запятыми.</small></label>
    {total > 1 && <label>Позиция на доске<input name="position" type="number" min={1} max={total} required defaultValue={index + 1} /></label>}
    <button className="button primary" disabled={pending}><Check size={17} /> Сохранить</button>
    <Feedback error={error} />
  </form>
}

function ConfirmDelete({ title, onClose, onDelete }: { title: string; onClose: () => void; onDelete: () => Promise<void> }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  return <Modal title={title} onClose={onClose}>
    <div className="inline-actions">
      <button className="button" onClick={onClose}>Отмена</button>
      <button className="button danger" disabled={pending} onClick={async () => {
        setPending(true)
        try { await onDelete() }
        catch (cause) { setError(cause); setPending(false) }
      }}>Удалить</button>
    </div>
    <Feedback error={error} />
  </Modal>
}
