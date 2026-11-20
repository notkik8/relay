import { useEffect, useRef, useState } from 'react'

type TurnstileOptions = {
  sitekey: string
  action: string
  language: string
  theme: 'light'
  size: 'compact' | 'flexible'
  'response-field': false
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

type TurnstileAPI = {
  render: (container: HTMLElement, options: TurnstileOptions) => string
  remove: (widget: string) => void
}

let scriptRequest: Promise<TurnstileAPI> | undefined

function loadTurnstile() {
  if (scriptRequest) return scriptRequest
  scriptRequest = new Promise<TurnstileAPI>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    const fail = () => {
      script.remove()
      reject(new Error('Cloudflare Turnstile unavailable'))
    }
    const timeout = window.setTimeout(fail, 10_000)
    script.onload = () => {
      window.clearTimeout(timeout)
      const api = (window as Window & { turnstile?: TurnstileAPI }).turnstile
      if (api) resolve(api)
      else fail()
    }
    script.onerror = () => { window.clearTimeout(timeout); fail() }
    document.head.append(script)
  }).catch((error: unknown) => {
    scriptRequest = undefined
    throw error
  })
  return scriptRequest
}

export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const node = container.current
    if (!node) return
    let active = true
    let cleanup: (() => void) | undefined
    const fail = () => { if (active) { onToken(null); setFailed(true) } }

    void loadTurnstile().then((api) => {
      if (!active) return
      let widget: string | undefined
      let size: TurnstileOptions['size'] | undefined
      const resize = new ResizeObserver(([entry]) => {
        const nextSize = entry.contentRect.width < 300 ? 'compact' : 'flexible'
        if (size === nextSize) return
        size = nextSize
        if (widget) api.remove(widget)
        onToken(null)
        try {
          widget = api.render(node, {
            sitekey: siteKey, action: 'register', language: 'ru', theme: 'light', size,
            'response-field': false,
            callback: (token) => { if (active) { setFailed(false); onToken(token) } },
            'expired-callback': () => { if (active) onToken(null) },
            'error-callback': fail,
          })
        } catch { fail() }
      })
      resize.observe(node)
      cleanup = () => { resize.disconnect(); if (widget) api.remove(widget) }
    }).catch(fail)

    return () => { active = false; cleanup?.() }
  }, [attempt, onToken, siteKey])

  return <div className="relay-auth-challenge">
    <div ref={container} />
    {failed && <div className="relay-auth-help" role="status">
      <p>Не удалось выполнить проверку безопасности.</p>
      <button className="relay-quiet" type="button" onClick={() => {
        setFailed(false)
        onToken(null)
        setAttempt((value) => value + 1)
      }}>Повторить проверку</button>
    </div>}
  </div>
}
