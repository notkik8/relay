import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, send } from '../api/client'
import type { Account } from '../api/types'
import { Feedback } from '../components/UI'

const redirectKey = 'relay.email.next'

function safeNext(value: string | null) {
  if (!value?.startsWith('/')) return '/'
  try {
    const url = new URL(value, window.location.origin)
    return url.origin === window.location.origin && !url.pathname.startsWith('//')
      ? `${url.pathname}${url.search}${url.hash}` : '/'
  } catch { return '/' }
}

function readRedirect() {
  try { return localStorage.getItem(redirectKey) }
  catch { return null }
}

function rememberRedirect(next: string | null) {
  try {
    if (next) localStorage.setItem(redirectKey, next)
    else localStorage.removeItem(redirectKey)
  } catch { /* Storage can be disabled. */ }
}

export function AuthPage({ mode = 'login' }: { mode?: 'login' | 'register' | 'verify' | 'resend' }) {
  const [params] = useSearchParams()
  const location = useLocation()
  const [next] = useState(() => safeNext(mode === 'verify' ? readRedirect() : params.get('next')))
  const [sent, setSent] = useState('')
  const [email, setEmail] = useState<string>(location.state?.email ?? '')
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  const cache = useQueryClient()
  const navigate = useNavigate()
  const register = mode === 'register'
  const verify = mode === 'verify'
  const token = location.hash.slice(1)
  const validLink = !verify || /^[A-Za-z0-9_-]{43}$/.test(token)
  const resendUrl = `/resend-email?${new URLSearchParams({ next })}`
  const loginUrl = `/login?${new URLSearchParams({ next })}`
  const registerUrl = `/register?${new URLSearchParams({ next })}`
  const title = { login: 'Войти в Relay', register: 'Создать аккаунт', verify: 'Подтвердить почту', resend: 'Запросить новое письмо' }[mode]
  const action = { login: 'Войти', register: 'Зарегистрироваться', verify: 'Подтвердить почту', resend: 'Отправить письмо' }[mode]

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget))
      if (register || mode === 'resend') {
        const result = await send<{ email: string }>(register ? '/accounts' : '/accounts/verification', 'POST', data)
        rememberRedirect(next)
        setSent(result.email)
        return
      }
      const user = await send<Account>(verify ? '/accounts/verify' : '/sessions', 'POST', verify ? { ...data, token } : data)
      await cache.cancelQueries()
      cache.removeQueries({ predicate: ({ queryKey }) => queryKey[0] !== 'session' })
      cache.setQueryData(['session'], user)
      rememberRedirect(null)
      navigate(next, { replace: true })
    } catch (cause) { setError(cause) }
    finally { setPending(false) }
  }

  return <div className="auth-wrap">
    <section className="panel auth-panel">
      <h1>{sent ? 'Проверьте почту' : title}</h1>
      {sent ? <>
        <p role="status">Мы отправили ссылку на <strong>{sent}</strong>. Откройте её и введите пароль от Relay. Ссылка действует 24 часа.</p>
        <div className="auth-alt"><Link to={loginUrl} state={{ email }}>Войти</Link> · <Link to={resendUrl} state={{ email }}>Запросить новое письмо</Link></div>
      </> : <>
        {validLink ? <form className="form-stack" onSubmit={submit}>
          {verify && <p>Введите пароль от Relay, чтобы подтвердить адрес и войти.</p>}
          {!verify && <label>Электронная почта<input name="email" type="email" autoComplete={register ? 'email' : 'username'}
            required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
          {register && <label>Имя пользователя<input name="username" autoComplete="nickname" required pattern="[A-Za-z0-9_]{3,32}" maxLength={32} />
            <small>Ник из 3–32 латинских букв, цифр или подчёркиваний.</small></label>}
          <label>Пароль<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'}
            required minLength={register ? 8 : 1} maxLength={128} />{register && <small>Минимум 8 символов.</small>}</label>
          <Feedback error={error} />
          <button className="button primary" disabled={pending}>{pending ? 'Подождите…' : action}<ArrowRight size={17} /></button>
        </form> : <p role="alert">Ссылка недействительна. Запросите новое письмо.</p>}
        <div className="auth-alt">
          {mode === 'login' ? <><Link to={registerUrl}>Зарегистрироваться</Link> · <Link to={resendUrl} state={{ email }}>Подтвердить почту</Link></>
            : <Link to={loginUrl} state={{ email }}>Вернуться ко входу</Link>}
          {mode !== 'login' && mode !== 'resend' && <> · <Link to={resendUrl} state={{ email }}>Запросить новое письмо</Link></>}
          {verify && error instanceof ApiError && error.status === 409 && <> · <Link to={registerUrl}>Начать регистрацию заново</Link></>}
        </div>
      </>}
    </section>
  </div>
}
