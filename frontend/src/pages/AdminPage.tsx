import { dateLabel } from '../components/format'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Flag, ListChecks, Search, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api, send } from '../api/client'
import { usePage, useSession } from '../api/queries'
import type { Account, MediaKind } from '../api/types'
import { ReasonForm } from '../components/BoardActions'
import { Avatar, Empty, Feedback, Loading, Modal } from '../components/UI'

type Action = 'dismiss' | 'hide' | 'restore' | 'delete' | 'block' | 'unblock'
interface AdminUser extends Account {
  blocked: boolean; deleted: boolean; created_at: string; boards?: number; comments?: number
}
interface Report {
  id: string; kind: 'board' | 'comment'; object_id: string; reason: string; reporter: string;
  created_at: string; object: string | null; resolution: string | null
}
interface Log {
  id: string; actor: string; kind: string; object_id: string; action: Action; reason: string; time: string
}
interface Stats { users: number; boards: number; comments: number; items: Record<MediaKind, number> }

const actions: Record<Action, string> = {
  dismiss: 'Отклонить жалобу', hide: 'Скрыть', restore: 'Восстановить', delete: 'Удалить',
  block: 'Заблокировать', unblock: 'Разблокировать',
}
const tabs = { reports: 'Жалобы', users: 'Пользователи', audit: 'Журнал', stats: 'Статистика' }
const icons = { reports: Flag, users: UsersRound, audit: ListChecks, stats: Activity }

export default function AdminPage() {
  const session = useSession()
  const cache = useQueryClient()
  const allowed = !!session.data?.admin
  const [tab, setTab] = useState<keyof typeof tabs>('reports')
  const [state, setState] = useState<'open' | 'resolved'>('open')
  const [search, setSearch] = useState('')
  const [person, setPerson] = useState<string>()
  const [dialog, setDialog] = useState<{ title: string; path: string; action: Action }>()
  const [message, setMessage] = useState('')
  const reportQuery = usePage<Report>('admin-reports', `/admin/reports?state=${state}`, allowed && tab === 'reports')
  const people = usePage<AdminUser>('admin-users', `/admin/users?q=${encodeURIComponent(search)}`, allowed && tab === 'users')
  const history = usePage<Log>('admin-audit', '/admin/audit', allowed && tab === 'audit')
  const detail = useQuery({
    queryKey: ['admin-user', person],
    queryFn: ({ signal }) => api<AdminUser>(`/admin/users/${person}`, { signal }),
    enabled: allowed && !!person && tab === 'users',
  })
  const stats = useQuery({
    queryKey: ['admin-stats'], queryFn: ({ signal }) => api<Stats>('/admin/stats', { signal }),
    enabled: allowed && tab === 'stats',
  })
  if (session.isPending) return <Loading />
  if (!session.data) return <Navigate to="/login?next=%2Fadmin" replace />
  if (!allowed) return <Empty title="Доступ только для администратора" />
  const data = detail.data
  const current = { reports: reportQuery, users: people, audit: history, stats }[tab]
  function moderate(path: string, action: Action, title: string) {
    setMessage('')
    setDialog({ title, path, action })
  }

  return <section className="admin-page">
    <div className="section-heading"><h1>Модерация</h1></div>
    <div className="segmented admin-tabs" aria-label="Раздел модерации">
      {(Object.keys(tabs) as (keyof typeof tabs)[]).map((entry) => {
        const Icon = icons[entry]
        return <button key={entry} aria-pressed={entry === tab} onClick={() => { setTab(entry); setMessage('') }}>
          <Icon size={17} />{tabs[entry]}</button>
      })}
    </div>
    {current.isPending && <Loading />}
    <Feedback error={current.error}>{message}</Feedback>
    {tab === 'reports' && <div className="admin-content">
      <div className="inline-actions">
        <button className={`button ${state === 'open' ? 'selected' : 'quiet'}`} aria-pressed={state === 'open'}
          onClick={() => setState('open')}>Открытые</button>
        <button className={`button ${state === 'resolved' ? 'selected' : 'quiet'}`} aria-pressed={state === 'resolved'}
          onClick={() => setState('resolved')}>Обработанные</button>
      </div>
      {reportQuery.isSuccess && !reportQuery.data.pages[0].items.length && <Empty title="Жалоб нет" />}
      {reportQuery.data?.pages.flatMap((page) => page.items).map((entry) => <article key={entry.id} className="panel compact admin-record">
        <div className="subtle-label"><Flag size={15} />{entry.kind === 'board' ? 'Подборка' : 'Комментарий'} · {dateLabel(entry.created_at)}</div>
        <h2>{entry.object ?? 'Объект недоступен'}</h2>
        <p>{entry.reason}</p><small className="muted">Жалоба от @{entry.reporter}</small>
        {entry.resolution ? <p><strong>Решение</strong> · {entry.resolution}</p> : <div className="inline-actions">
          {(['dismiss', 'hide', 'delete'] as const).map((action) => <button key={action}
            className={`button ${action === 'delete' ? 'danger-text' : ''}`}
            onClick={() => moderate(`/admin/reports/${entry.id}/resolution`, action, actions[action])}>{actions[action]}</button>)}
        </div>}
        {entry.resolution?.startsWith('hide:') && <button className="button"
          onClick={() => moderate(`/admin/objects/${entry.kind}/${entry.object_id}`, 'restore', 'Восстановить объект')}>Восстановить объект</button>}
      </article>)}
      {reportQuery.hasNextPage && <button className="button" disabled={reportQuery.isFetchingNextPage}
        onClick={() => void reportQuery.fetchNextPage()}>Ещё жалобы</button>}
    </div>}
    {tab === 'users' && <div className="admin-content">
      <form className="search-form" onSubmit={(event) => {
        event.preventDefault()
        setSearch(String(new FormData(event.currentTarget).get('q')).trim())
      }}>
        <input type="search" name="q" placeholder="Имя пользователя" aria-label="Поиск пользователей" maxLength={32} defaultValue={search} />
        <button className="button" aria-label="Найти пользователя"><Search size={18} /></button>
      </form>
      <div className="admin-users-grid">
        <div className="form-stack">
          {people.isSuccess && !people.data.pages[0].items.length && <Empty title="Пользователи не найдены" />}
          {people.data?.pages.flatMap((page) => page.items).map((user) =>
            <button key={user.id} className={`person-card ${person === user.id ? 'selected' : ''}`}
              onClick={() => setPerson(user.id)}><Avatar person={user} /><span><strong>{user.name}</strong>
              <small>@{user.username}{user.blocked && ' · заблокирован'}{user.deleted && ' · удалён'}</small></span></button>)}
          {people.hasNextPage && <button className="button" disabled={people.isFetchingNextPage}
            onClick={() => void people.fetchNextPage()}>Ещё пользователи</button>}
        </div>
        <div>
          <Feedback error={detail.error} />
          {person && detail.isPending && <Loading />}
          {data && <article className="panel compact admin-record">
            <Avatar person={data} />
            <h2>{data.name}</h2>
            <p>@{data.username}{data.email && <> · {data.email}</>}</p>
            <p>{data.bio}</p>
            <p className="muted">Подборок: {data.boards} · Комментариев: {data.comments}</p>
            {!data.admin && !data.deleted && <div className="inline-actions">
              <button className="button" onClick={() => moderate(
                `/admin/objects/user/${data.id}`, data.blocked ? 'unblock' : 'block', `Аккаунт @${data.username}`,
              )}>{actions[data.blocked ? 'unblock' : 'block']}</button>
              <button className="button danger-text" onClick={() => moderate(
                `/admin/objects/user/${data.id}`, 'delete', `Удалить аккаунт @${data.username}?`,
              )}>Удалить аккаунт</button>
            </div>}
          </article>}
        </div>
      </div>
    </div>}
    {tab === 'audit' && <div className="admin-content">
      {history.isSuccess && !history.data.pages[0].items.length && <Empty title="Журнал пока пуст" />}
      {history.data?.pages.flatMap((page) => page.items).map((log) => <article key={log.id} className="panel compact admin-record">
        <div className="subtle-label">@{log.actor} · {dateLabel(log.time)}</div>
        <h2>{actions[log.action]}</h2><p>{log.reason}</p>
        <small className="muted">{{ user: 'Аккаунт', board: 'Подборка', comment: 'Комментарий' }[log.kind]} · {log.object_id}</small>
      </article>)}
      {history.hasNextPage && <button className="button" disabled={history.isFetchingNextPage}
        onClick={() => void history.fetchNextPage()}>Ещё записи</button>}
    </div>}
    {tab === 'stats' && stats.data && <div className="stat-grid">
      {Object.entries({
        Пользователи: stats.data.users, Подборки: stats.data.boards, Комментарии: stats.data.comments,
        Треки: stats.data.items.track, Фильмы: stats.data.items.film, Изображения: stats.data.items.image,
      }).map(([label, count]) => <article className="panel compact stat" key={label}><strong>{count}</strong><span>{label}</span></article>)}
    </div>}
    {dialog && <Modal title={dialog.title} onClose={() => setDialog(undefined)}>
      <ReasonForm action={actions[dialog.action]} onSubmit={async (reason) => {
        await send(dialog.path, 'POST', { reason, action: dialog.action })
        await cache.invalidateQueries({ predicate: ({ queryKey }) => String(queryKey[0]).startsWith('admin-') })
        setMessage('Действие сохранено в журнале')
        setDialog(undefined)
      }} />
    </Modal>}
  </section>
}
