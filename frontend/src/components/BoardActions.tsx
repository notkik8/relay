import { dateLabel } from './format'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Check, Heart, Send, Trash2, UserRoundPlus } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, send } from '../api/client'
import { useFeed, usePage, useSession } from '../api/queries'
import type { Board, Comment, Item, Person } from '../api/types'
import { Avatar, Feedback, Loading, Modal } from './UI'

export function SignInLink({ children }: { children: ReactNode }) {
  const location = useLocation()
  return <Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>{children}</Link>
}

export function LikeButton({ path, count, liked, onChange }: {
  path: string; count: number; liked: boolean; onChange: () => Promise<unknown>
}) {
  const { data: user } = useSession()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  if (!user) return <span className="count-pill"><Heart size={17} />{count}</span>
  return <div>
    <button type="button" className={`button like-button${liked ? ' selected' : ''}`} aria-pressed={liked}
      aria-label={liked ? 'Убрать лайк' : 'Поставить лайк'} disabled={pending} onClick={async () => {
        setPending(true)
        setError(undefined)
        try { await send(`${path}/like`, liked ? 'DELETE' : 'PUT'); await onChange() }
        catch (cause) { setError(cause) }
        finally { setPending(false) }
      }}><Heart size={17} fill={liked ? 'currentColor' : 'none'} />{count}</button>
    <Feedback error={error} />
  </div>
}

export function ReasonForm({ action, onSubmit, label = 'Причина' }: {
  action: string; onSubmit: (reason: string) => Promise<void>; label?: string
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  const [done, setDone] = useState(false)
  return <form className="form-stack" onSubmit={async (event) => {
    event.preventDefault()
    const reason = String(new FormData(event.currentTarget).get('reason')).trim()
    setPending(true)
    setError(undefined)
    try { await onSubmit(reason); setDone(true) }
    catch (cause) { setError(cause) }
    finally { setPending(false) }
  }}>
    <label>{label}<textarea name="reason" rows={3} required minLength={3} maxLength={1000} disabled={done} /></label>
    <button className="button primary" disabled={pending || done}>{pending ? 'Отправляем…' : action}</button>
    <Feedback error={error}>{done ? 'Действие выполнено' : null}</Feedback>
  </form>
}

export function ReportDialog({ board, target, onClose }: {
  board: Board; target: { kind: 'board' | 'comment'; id: string }; onClose: () => void
}) {
  return <Modal title={target.kind === 'board' ? 'Жалоба на подборку' : 'Жалоба на комментарий'} onClose={onClose}>
    <ReasonForm action="Отправить жалобу" onSubmit={async (reason) => {
      await send(`/boards/${board.key}/reports`, 'POST', {
        kind: target.kind, object_id: target.id, reason,
      })
    }} />
  </Modal>
}

export function DestinationDialog({ board, item, mode, onClose, onChange }: {
  board: Board; item: Item; mode: 'save' | 'move'; onClose: () => void; onChange: () => Promise<void>
}) {
  const feed = useFeed('mine')
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  const [destination, setDestination] = useState<Board>()
  const boards = feed.data?.pages.flatMap((page) => page.items).filter(
    (entry) => entry.key !== board.key && (mode !== 'save' || entry.owned),
  ) ?? []
  return <Modal title={mode === 'save' ? 'Сохранить в подборку' : 'Перенести в подборку'} onClose={onClose}>
    <div className="form-stack">
      <p className="muted">{item.title}</p>
      {feed.isPending && <Loading />}
      {!destination && boards.map((entry) => <button key={entry.key} className="button destination"
        disabled={pending} onClick={async () => {
          setPending(true)
          setError(undefined)
          try {
            await send(`/boards/${board.key}/items/${item.id}/${mode}`, 'POST', { board_id: entry.key })
            setDestination(entry)
            await onChange()
          } catch (cause) { setError(cause) }
          finally { setPending(false) }
        }}>{entry.title}<ArrowUpRight size={17} /></button>)}
      {!destination && feed.hasNextPage && <button className="button quiet" disabled={feed.isFetchingNextPage}
        onClick={() => void feed.fetchNextPage()}>Ещё подборки</button>}
      {!destination && feed.isSuccess && !boards.length && <p>Нет подходящих подборок. <Link to="/new">Создать подборку</Link></p>}
      <Feedback error={error ?? feed.error} />
      {destination && <div className="inline-actions"><Check size={18} /><Link to={`/b/${destination.key}`}>Открыть «{destination.title}»</Link></div>}
    </div>
  </Modal>
}

export function Comments({ board, onReport }: { board: Board; onReport: (id: string) => void }) {
  const url = `/boards/${board.key}/comments`
  const query = usePage<Comment>('comments', url)
  const { data: user } = useSession()
  const cache = useQueryClient()
  const [text, setText] = useState('')
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  const entries = query.data?.pages.flatMap((page) => page.items) ?? []
  async function save(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    try {
      await send(url, 'POST', { text })
      setText('')
      await Promise.all([query.refetch(), cache.invalidateQueries({ queryKey: ['board', board.key] })])
    } catch (cause) { setError(cause) }
    finally { setPending(false) }
  }
  return <section className="comments-section" aria-labelledby="comments-heading">
    <div className="section-heading"><h2 id="comments-heading">Комментарии <span className="number">{board.comments}</span></h2></div>
    {user ? <form className="comment-form" onSubmit={save}>
      <Avatar person={user} />
      <div className="form-stack">
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={2}
          required maxLength={2000} aria-label="Комментарий" placeholder="Поделитесь впечатлением…" />
        <button className="button primary" disabled={pending || !text.trim()}>
          <Send size={16} /> {pending ? 'Отправляем…' : 'Отправить'}
        </button>
      </div>
    </form> : <p className="muted"><SignInLink>Войдите</SignInLink>, чтобы оставить комментарий.</p>}
    <Feedback error={error ?? query.error} />
    {query.isPending && <Loading />}
    {query.isSuccess && !entries.length && <p className="muted">Комментариев пока нет.</p>}
    <div className="comment-list">
      {entries.map((entry) => <article className="comment" key={entry.id} id={`comment-${entry.id}`}>
        <Avatar person={entry.author} />
        <div>
          <Link to={`/u/${entry.author.username}`}>{entry.author.name}</Link>
          <time dateTime={entry.created_at}>{dateLabel(entry.created_at)}</time>
          <p>{entry.text}</p>
        </div>
        {user && (entry.owned ? <button className="icon-button" type="button" title="Удалить комментарий" aria-label="Удалить комментарий"
          onClick={async () => {
            try {
              await send(`${url}/${entry.id}`, 'DELETE')
              await Promise.all([query.refetch(), cache.invalidateQueries({ queryKey: ['board', board.key] })])
            } catch (cause) { setError(cause) }
          }}><Trash2 size={17} /></button> : <button className="button quiet" onClick={() => onReport(entry.id)}>Пожаловаться</button>)}
      </article>)}
    </div>
    {query.hasNextPage && <button className="button" disabled={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}>Ещё комментарии</button>}
  </section>
}

export function Members({ boardKey }: { boardKey: string }) {
  const path = `/boards/${boardKey}/members`
  const query = useQuery({
    queryKey: ['members', boardKey],
    queryFn: ({ signal }) => api<{ user: Person; status: 'pending' | 'accepted' | 'declined' }[]>(path, { signal }),
  })
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  return <section className="form-stack">
    <h3>Редакторы</h3>
    <form className="search-form" onSubmit={async (event) => {
      event.preventDefault()
      const form = event.currentTarget
      setPending(true)
      setError(undefined)
      try {
        await send(path, 'POST', { username: new FormData(form).get('username') })
        form.reset()
        await query.refetch()
      } catch (cause) { setError(cause) }
      finally { setPending(false) }
    }}>
      <input name="username" aria-label="Имя пользователя для приглашения" placeholder="Имя пользователя" required pattern="[A-Za-z0-9_]{3,32}" />
      <button className="button" disabled={pending} aria-label="Пригласить"><UserRoundPlus size={18} /></button>
    </form>
    <Feedback error={error ?? query.error} />
    {query.data?.map(({ user, status }) => <div className="member" key={user.id}>
      <Avatar person={user} size="small" />
      <div><Link to={`/u/${user.username}`}>{user.name}</Link>
        <small>{{ pending: 'Ожидает ответа', accepted: 'Редактор', declined: 'Отклонено' }[status]}</small></div>
      <button className="button quiet" onClick={async () => {
        try { await send(`${path}/${user.username}`, 'DELETE'); await query.refetch() }
        catch (cause) { setError(cause) }
      }}>Отозвать</button>
    </div>)}
  </section>
}
