import { useQueryClient } from '@tanstack/react-query'
import { Bell, Compass, Layers3, LogOut, Plus, Search, Shield, UserRound, UsersRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { send } from '../api/client'
import { useSession } from '../api/queries'
import { Avatar, Brand, Feedback } from './UI'

export function Layout() {
  const session = useSession()
  const user = session.data
  const navigate = useNavigate()
  const location = useLocation()
  const client = useQueryClient()
  const [error, setError] = useState<unknown>()
  const next = encodeURIComponent(location.pathname + location.search)

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = String(new FormData(event.currentTarget).get('q') ?? '').trim()
    if (query) navigate(`/search?q=${encodeURIComponent(query)}`)
  }

  async function logout() {
    try {
      await send('/sessions/current', 'DELETE')
      await client.cancelQueries()
      client.setQueryData(['session'], null)
      client.removeQueries({ predicate: ({ queryKey }) => queryKey[0] !== 'session' })
      navigate('/')
    } catch (cause) { setError(cause) }
  }

  return <div className="app-shell">
    <a href="#main" className="skip-link">К содержимому</a>
    <header className="top-bar">
      <div className="top-inner">
        <Brand />
        <nav className="primary-nav" aria-label="Разделы">
          <NavLink end to="/"><Compass size={17} />Обзор</NavLink>
          {user && <><NavLink to="/following"><UsersRound size={17} />Подписки</NavLink>
            <NavLink to="/mine"><Layers3 size={17} />Мои подборки</NavLink></>}
        </nav>
        <form className="nav-search" role="search" onSubmit={search} key={location.search}>
          <Search size={17} aria-hidden="true" />
          <input name="q" type="search" aria-label="Поиск подборок, людей и тегов"
            placeholder="Подборки, люди, теги…" maxLength={120}
            defaultValue={location.pathname === '/search' ? new URLSearchParams(location.search).get('q') ?? '' : ''} />
          <button className="visually-hidden" type="submit">Найти</button>
        </form>
        <div className="nav-actions">
          <Link className="button primary create-button" aria-label="Создать подборку" to={user ? '/new' : '/login?next=%2Fnew'}>
            <Plus size={18} /> <span className="create-long">Создать подборку</span><span className="create-short">Создать</span>
          </Link>
          {user ? <>
            <NavLink to="/notifications" className="icon-button" title="Уведомления" aria-label="Уведомления"><Bell size={20} /></NavLink>
            <details className="account-menu" key={location.key}>
              <summary aria-label="Меню аккаунта"><Avatar person={user} /></summary>
              <div className="account-popover">
                <strong>{user.name}</strong>
                <Link to={`/u/${user.username}`}><UserRound size={16} /> Профиль</Link>
                {user.admin && <Link to="/admin"><Shield size={16} /> Модерация</Link>}
                <button onClick={() => void logout()}><LogOut size={16} /> Выйти</button>
              </div>
            </details>
          </> : <Link className="button quiet login-button" to={`/login?next=${next}`}>Войти</Link>}
        </div>
      </div>
    </header>
    <main id="main" className="container" tabIndex={-1}><Feedback error={error} /><Outlet /></main>
    <footer className="footer container"><Brand /><span>Музыка, кино и изображения в одной подборке.</span></footer>
  </div>
}
