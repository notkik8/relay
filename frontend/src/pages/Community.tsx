import { dateLabel } from '../components/format'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Bell, Check, Pencil, Search, UserRoundPlus, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { api, send, upload } from '../api/client'
import { usePage, useSession } from '../api/queries'
import type { Account, Board, Notice, Page, Person } from '../api/types'
import { SignInLink } from '../components/BoardActions'
import { FileForm } from '../components/BoardForms'
import { Avatar, BoardGrid, Empty, Feedback, Loading, Modal } from '../components/UI'
import { ProfileCollections, ProfilePins } from './PinPages'

interface Profile {
  user: Person
  followers: number
  following: number
  is_following: boolean
  boards: Page<Board>
}

export function ProfilePage() {
  const { username = '' } = useParams()
  return <ProfileView key={username} username={username} />
}

function ProfileView({ username }: { username: string }) {
  const [params] = useSearchParams()
  const tab = params.get('tab') ?? 'pins'
  const { data: account } = useSession()
  const query = useQuery({
    queryKey: ['profile', username],
    queryFn: ({ signal }) => api<Profile>(`/profiles/${username}`, { signal }),
    retry: false,
  })
  const cache = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  const [extra, setExtra] = useState<Board[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>()
  if (query.isPending) return <Loading />
  if (!query.data) return <Empty title="Профиль недоступен"><Feedback error={query.error} /></Empty>
  const data = query.data
  const own = account?.id === data.user.id
  const next = nextOffset === undefined ? data.boards.next_offset : nextOffset
  async function updated(user: Account) {
    cache.setQueryData(['session'], user)
    await Promise.all([query.refetch(), cache.invalidateQueries({ queryKey: ['feed'] })])
  }
  return <div className="profile-page">
    <section className="profile-intro panel">
      <Avatar person={data.user} size="large" />
      <div>
        <span className="muted">@{data.user.username}</span>
        <h1>{data.user.name}</h1>
        {data.user.bio && <p>{data.user.bio}</p>}
        <div className="profile-counts"><span><strong>{data.followers}</strong> подписчиков</span>
          <span><strong>{data.following}</strong> подписок</span></div>
      </div>
      {own ? <button className="button" onClick={() => { setError(undefined); setEditing(true) }}><Pencil size={17} /> Редактировать</button>
        : account ? <button className={`button ${data.is_following ? 'selected' : 'primary'}`} disabled={pending} onClick={async () => {
          setError(undefined)
          setPending(true)
          try {
            await send(`/profiles/${username}/follow`, data.is_following ? 'DELETE' : 'PUT')
            await Promise.all([query.refetch(), cache.invalidateQueries({ queryKey: ['feed', 'following'] })])
          } catch (cause) { setError(cause) }
          finally { setPending(false) }
        }}>{data.is_following ? <Check size={17} /> : <UserRoundPlus size={17} />}
          {data.is_following ? 'Отписаться' : 'Подписаться'}</button> : <SignInLink>Войти, чтобы подписаться</SignInLink>}
    </section>
    <Feedback error={!editing ? error : null} />
    <nav className="pin-tabs" aria-label="Разделы профиля">
      {([['pins', 'Пины'], ['folders', 'Папки'], ['boards', 'Подборки']] as const).map(([key, label]) =>
        <Link key={key} to={`?tab=${key}`} aria-current={tab === key ? 'page' : undefined}
          className={`button${tab === key ? ' selected' : ''}`}>{label}</Link>)}
    </nav>
    {tab !== 'folders' && tab !== 'boards' && <ProfilePins username={data.user.username} own={own} />}
    {tab === 'folders' && <ProfileCollections username={data.user.username} own={own} />}
    {tab === 'boards' && <section>
      <div className="section-heading"><h2>Подборки</h2></div>
      {data.boards.items.length ? <BoardGrid boards={[...data.boards.items, ...extra]} />
        : <Empty title="Подборок пока нет">{own && <Link className="button primary" to="/new">Создать подборку</Link>}</Empty>}
      {next !== null && <div className="more"><button className="button" disabled={pending} onClick={async () => {
        setPending(true)
        try {
          const response = await api<Profile>(`/profiles/${username}?offset=${next}`)
          setExtra([...extra, ...response.boards.items])
          setNextOffset(response.boards.next_offset)
        } catch (cause) { setError(cause) }
        finally { setPending(false) }
      }}>Ещё подборки</button></div>}
    </section>}
    {editing && <Modal title="Мой профиль" onClose={() => setEditing(false)}>
      <div className="form-stack settings">
        <form className="form-stack" onSubmit={async (event) => {
          event.preventDefault()
          const data = Object.fromEntries(new FormData(event.currentTarget))
          setPending(true)
          setError(undefined)
          try { await updated(await send<Account>('/accounts/me', 'PUT', data)); setEditing(false) }
          catch (cause) { setError(cause) }
          finally { setPending(false) }
        }}>
          <label>Имя<input name="name" defaultValue={data.user.name} required maxLength={80} /></label>
          <label>О себе<textarea name="bio" defaultValue={data.user.bio} maxLength={600} rows={4} /></label>
          <button className="button primary" disabled={pending}>Сохранить профиль</button>
          <Feedback error={error} />
        </form>
        <FileForm label="Аватар" action="Загрузить аватар"
          onUpload={async (file) => updated(await upload<Account>('/accounts/me/avatar', 'PUT', file))} />
      </div>
    </Modal>}
  </div>
}

interface SearchResult { boards: Page<Board>; users: Page<Person>; tags: Page<string> }

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const search = params.get('q')?.trim() ?? ''
  const offset = Math.max(0, Number(params.get('offset')) || 0)
  const result = useQuery({
    queryKey: ['search', search, offset],
    queryFn: ({ signal }) => api<SearchResult>(`/search?q=${encodeURIComponent(search)}&offset=${offset}`, { signal }),
    enabled: !!search,
  })
  const data = result.data
  const next = data && (data.boards.next_offset ?? data.users.next_offset ?? data.tags.next_offset)
  return <section className="search-page">
    <div className="section-heading"><div><h1>Поиск</h1>{search && <p>Результаты по запросу «{search}»</p>}</div></div>
    <form className="search-form panel-search" key={search} onSubmit={(event) => {
      event.preventDefault()
      const q = String(new FormData(event.currentTarget).get('q')).trim()
      if (q) setParams({ q })
    }}>
      <input type="search" name="q" aria-label="Поисковый запрос" defaultValue={search} maxLength={120} required
        placeholder="Название подборки, имя или тег" />
      <button className="button primary"><Search size={17} /> Найти</button>
    </form>
    {result.isFetching && <Loading />}
    <Feedback error={result.error} />
    {data && <>
      {!!data.tags.items.length && <div className="search-group">
        <h2>Теги</h2><div className="tag-list">{data.tags.items.map((tag) =>
          <Link className="tag" key={tag} to={`/search?q=${encodeURIComponent('#' + tag)}`}>#{tag}</Link>)}</div>
      </div>}
      {!!data.users.items.length && <div className="search-group">
        <h2>Люди</h2><div className="people-grid">{data.users.items.map((person) =>
          <Link className="person-card" key={person.id} to={`/u/${person.username}`}>
            <Avatar person={person} /><span><strong>{person.name}</strong><small>@{person.username}</small></span><ArrowUpRight size={17} />
          </Link>)}</div>
      </div>}
      {!!data.boards.items.length && <div className="search-group"><h2>Подборки</h2><BoardGrid boards={data.boards.items} /></div>}
      {!data.boards.items.length && !data.users.items.length && !data.tags.items.length &&
        <Empty title="Ничего не нашлось"><p>Попробуйте другое название, имя или тег.</p></Empty>}
      {(offset > 0 || next != null) && <div className="inline-actions more">
        {offset > 0 && <Link className="button" to={`/search?q=${encodeURIComponent(search)}&offset=${offset - 12}`}>Назад</Link>}
        {next != null && <Link className="button" to={`/search?q=${encodeURIComponent(search)}&offset=${next}`}>Дальше</Link>}
      </div>}
    </>}
  </section>
}

export function NotificationsPage() {
  const session = useSession()
  const query = usePage<Notice>('notifications', '/notifications', !!session.data)
  const cache = useQueryClient()
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  if (session.isPending) return <Loading />
  if (!session.data) return <Navigate to="/login?next=%2Fnotifications" replace />
  const notices = query.data?.pages.flatMap((page) => page.items) ?? []
  const labels = { follow: 'Новая подписка', invite: 'Приглашение в подборку', like: 'Новый лайк', comment: 'Новый комментарий' }
  async function action(path: string, body?: object) {
    setError(undefined)
    setPending(true)
    try {
      await send(path, 'PUT', body)
      await Promise.all([query.refetch(), cache.invalidateQueries({ queryKey: ['feed', 'mine'] })])
    } catch (cause) { setError(cause) }
    finally { setPending(false) }
  }
  return <section className="notifications-page">
    <div className="section-heading"><h1>Уведомления</h1>
      {notices.some((notice) => !notice.read) && <button className="button" disabled={pending}
        onClick={() => void action('/notifications/read')}><Check size={17} /> Прочитать все</button>}
    </div>
    {query.isPending && <Loading />}
    <Feedback error={error ?? query.error} />
    {query.isSuccess && !notices.length && <Empty title="Уведомлений пока нет" />}
    <div className="notifications-list">
      {notices.map((notice) => {
        const anchor = notice.object_id && notice.type !== 'invite'
          ? `#${notice.type === 'comment' ? 'comment' : 'item'}-${notice.object_id}` : ''
        return <article className={`notice${notice.read ? '' : ' unread'}`} key={notice.id}>
          <span className="notice-icon">{notice.type === 'follow' ? <UsersRound size={19} /> : <Bell size={18} />}</span>
          <div className="notice-copy"><strong>{labels[notice.type]}</strong><p>
            <Link to={`/u/${notice.actor.username}`}>{notice.actor.name}</Link>
            {notice.board_title && <> · {notice.board_key ?
              <Link to={`/b/${notice.board_key}${anchor}`}>{notice.board_title}</Link> : notice.board_title}</>}</p>
            <time dateTime={notice.created_at}>{dateLabel(notice.created_at)}</time>
          </div>
          {notice.pending && <div className="inline-actions">
            <button className="button primary" disabled={pending} onClick={() => void action(
              `/notifications/${notice.id}/invite`, { accept: true })}>Принять</button>
            <button className="button quiet" disabled={pending} onClick={() => void action(
              `/notifications/${notice.id}/invite`, { accept: false })}>Отклонить</button>
          </div>}
        </article>
      })}
    </div>
    {query.hasNextPage && <div className="more"><button className="button" disabled={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}>Ещё уведомления</button></div>}
  </section>
}
