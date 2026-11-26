import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Copy } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, send } from '../api/client'
import type { Account } from '../api/types'
import { Turnstile } from '../components/Turnstile'
import './auth.css'

type Mode = 'login' | 'register' | 'recover'
type AccountWithRecovery = { account: Account; recovery_code: string }

const page = {
  login: { title: 'Войти в Relay', action: 'Войти' },
  register: { title: 'Создать аккаунт', action: 'Зарегистрироваться' },
  recover: { title: 'Восстановить доступ', action: 'Сменить пароль' },
}

function safeNext(value: string | null) {
  if (!value?.startsWith('/')) return '/'
  try {
    const url = new URL(value, window.location.origin)
    return url.origin === window.location.origin && !url.pathname.startsWith('//')
      ? `${url.pathname}${url.search}${url.hash}` : '/'
  } catch { return '/' }
}

export function AuthPage({ mode = 'login' }: { mode?: Mode }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const next = safeNext(params.get('next'))
  const links = new URLSearchParams({ next })
  const [recoveryCode, setRecoveryCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  const [challenge, setChallenge] = useState<string | null>(null)
  const [challengeAttempt, setChallengeAttempt] = useState(0)
  const register = mode === 'register'
  const recover = mode === 'recover'
  const newPassword = register || recover
  const registration = useQuery({
    queryKey: ['registration'], enabled: register, retry: false,
    queryFn: ({ signal }) => api<{ turnstile_site_key: string | null }>('/accounts/registration', { signal }),
  })
  const siteKey = registration.data?.turnstile_site_key
  const { title, action } = page[mode]

  async function signIn(user: Account) {
    await cache.cancelQueries()
    cache.removeQueries({ predicate: ({ queryKey }) => queryKey[0] !== 'session' })
    cache.setQueryData(['session'], user)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || (register && !challenge)) return
    setPending(true)
    setError(undefined)
    const fields = new FormData(event.currentTarget)
    const username = String(fields.get('username') ?? '')
    const password = String(fields.get('password') ?? '')
    try {
      if (register || recover) {
        const result = await send<AccountWithRecovery>(register ? '/accounts' : '/accounts/recovery', 'POST',
          register ? { username, password, turnstile_token: challenge }
            : { username, password, recovery_code: String(fields.get('recovery_code') ?? '') })
        await signIn(result.account)
        setRecoveryCode(result.recovery_code)
        return
      }
      const user = await send<Account>('/sessions', 'POST', { username: username.trim(), password })
      await signIn(user)
      navigate(next, { replace: true })
    } catch (cause) {
      setError(cause)
      if (register) {
        setChallenge(null)
        setChallengeAttempt((attempt) => attempt + 1)
      }
    } finally { setPending(false) }
  }

  return <div className="relay-discovery relay-auth">
    <a href="#auth-main" className="skip-link">К содержимому</a>
    <header className="relay-topbar">
      <div className="relay-top-inner relay-auth-nav">
        <Link to="/" className="relay-home-link" aria-label="Relay — лента">Relay</Link>
        <Link to="/" className="relay-quiet"><ArrowLeft size={16} aria-hidden="true" /> В ленту</Link>
      </div>
    </header>
    <main id="auth-main" className="relay-board relay-auth-area" tabIndex={-1}>
      <section className="relay-auth-panel" aria-labelledby="auth-title">
        <h1 id="auth-title">{recoveryCode ? 'Сохраните код восстановления' : title}</h1>
        {recoveryCode ? <div className="relay-auth-form">
          <p>Код нужен, чтобы сменить пароль. Сохраните его в безопасном месте. После использования код обновится.</p>
          <div className="relay-auth-code">
            <code>{recoveryCode}</code>
            <button type="button" className="relay-icon" aria-label="Скопировать код восстановления" onClick={() => {
              void navigator.clipboard.writeText(recoveryCode).then(() => setCopied(true)).catch(() => setCopied(false))
            }}><Copy size={17} aria-hidden="true" /></button>
          </div>
          {copied && <p role="status">Код скопирован.</p>}
          <button type="button" className="relay-primary relay-auth-action" onClick={() => navigate(next, { replace: true })}>
            Продолжить <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div> : <>
          <form className="relay-auth-form" onSubmit={submit}>
            <div className="relay-auth-field"><label htmlFor="auth-username">Ник</label>
              <input id="auth-username" name="username" autoComplete="username" autoCapitalize="none"
              spellCheck={false} required pattern="[A-Za-z0-9_]{3,32}" maxLength={32} aria-describedby={register ? 'auth-handle-help' : undefined} />
              {register && <small id="auth-handle-help">3–32 латинские буквы, цифры или подчёркивания.</small>}</div>
            {recover && <label>Код восстановления<input name="recovery_code" autoComplete="off" autoCapitalize="none" spellCheck={false}
              required maxLength={48} /></label>}
            <div className="relay-auth-field"><label htmlFor="auth-password">{recover ? 'Новый пароль' : 'Пароль'}</label>
              <input id="auth-password" name="password" type="password" autoComplete={newPassword ? 'new-password' : 'current-password'}
              required minLength={newPassword ? 15 : 1} maxLength={128} aria-describedby={newPassword ? 'auth-password-help' : undefined} />
              {newPassword && <small id="auth-password-help">Минимум 15 символов.</small>}</div>
            {register && (siteKey ? <Turnstile key={challengeAttempt} siteKey={siteKey} onToken={setChallenge} />
              : registration.isError ? <div className="relay-auth-help">
                <p role="status">Не удалось проверить доступность регистрации.</p>
                <button className="relay-quiet" type="button" onClick={() => void registration.refetch()}>Повторить</button>
              </div> : <p role="status">{registration.isPending ? 'Подключаем проверку безопасности…' : 'Регистрация временно недоступна.'}</p>)}
            {error instanceof Error && <p className="relay-auth-error" role="alert">{error.message}</p>}
            <button className="relay-primary relay-auth-action" disabled={pending || (register && (!siteKey || !challenge))}>
              {pending ? 'Подождите…' : action}<ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>
          <div className="relay-auth-links">
            {mode === 'login' ? <>
              <Link to={`/register?${links}`}>Создать аккаунт</Link>
              <Link to={`/recover?${links}`}>Забыли пароль?</Link>
            </> : <Link to={`/login?${links}`}>Вернуться ко входу</Link>}
          </div>
        </>}
      </section>
    </main>
  </div>
}
