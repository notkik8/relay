import { useQuery } from '@tanstack/react-query'
import { Bookmark, Settings2, Search, X } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Navigate, useLocation, useMatch, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import { loadCatalog, normalized, pinPath, searchable, type Material } from './catalog'
import { Detail, Preferences } from './Detail'
import { Results, type ResultProgress } from './Results'
import { Notice } from './Notice'
import { similarTo } from './recommend'
import { useDiscoveryLibrary } from './useDiscoveryLibrary'
import './discovery.css'

type Position = { y: number; materialId?: string }
const historyLimit = 32
const newSeed = () => Math.floor(Math.random() * 2 ** 32)

export default function DiscoveryPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const [params] = useSearchParams()
  const savedView = location.pathname === '/saved'
  const pinId = useMatch('/pin/:materialId')?.params.materialId
  const legacyId = pinId ? null : params.get('m')
  const queryText = pinId ? '' : params.get('q') ?? ''
  const deferred = useDeferredValue(queryText)
  const query = deferred.trim()
  const catalog = useQuery({ queryKey: ['discovery'], queryFn: ({ signal }) => loadCatalog(signal), staleTime: Infinity, retry: false })
  const all = catalog.data
  const { library, live, signal, save, hide, notify, notice, dismiss, undo, toggle, reset } = useDiscoveryLibrary()
  const [seed, setSeed] = useState(newSeed)
  const [preferences, setPreferences] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const main = useRef<HTMLElement>(null)
  const positions = useRef(new Map<string, Position>())
  const resultsHistory = useRef(new Map<string, ResultProgress>())
  const detailAudio = useRef<HTMLAudioElement>(null)
  const player = useRef<{ material: Material; audio: HTMLAudioElement } | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const entryKey = location.key

  const stopPreview = useCallback(() => {
    const current = player.current
    if (!current) return
    player.current = null
    current.audio.pause()
    current.audio.removeAttribute('src')
    current.audio.load()
    setPlaying(null)
  }, [])

  const preview = useCallback((material: Material) => {
    if (!material.audio) return
    const wasPlaying = player.current?.material.id === material.id
    stopPreview()
    if (wasPlaying) return
    detailAudio.current?.pause()
    const audio = new Audio(material.audio)
    player.current = { material, audio }
    setPlaying(material.id)
    const failed = () => {
      if (player.current?.audio !== audio) return
      stopPreview()
      notify('Запись не загрузилась. Её можно открыть у источника.')
    }
    audio.onended = () => { if (player.current?.audio === audio) stopPreview() }
    audio.onerror = failed
    void audio.play().then(() => {
      if (player.current?.audio === audio) signal(material, 'play')
    }).catch(failed)
  }, [notify, signal, stopPreview])

  useEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => {
      window.history.scrollRestoration = previous
      stopPreview()
    }
  }, [stopPreview])

  useLayoutEffect(() => {
    stopPreview()
  }, [location.pathname, location.search, stopPreview])

  useLayoutEffect(() => {
    if (!catalog.isSuccess || legacyId) return
    const stored = navigationType === 'POP' ? positions.current.get(entryKey) : undefined
    if (!stored) window.scrollTo(0, 0)
    const frame = window.requestAnimationFrame(() => {
      if (stored) {
        window.scrollTo(0, stored.y)
        const card = stored.materialId && document.getElementById(`pin-link-${stored.materialId}`)
        if (card) card.focus({ preventScroll: true })
        else if (document.activeElement !== search.current) main.current?.focus({ preventScroll: true })
      } else if (pinId && document.activeElement !== search.current) {
        main.current?.focus({ preventScroll: true })
      }
      positions.current.set(entryKey, { ...stored, y: window.scrollY })
      if (positions.current.size > historyLimit) {
        const oldest = positions.current.keys().next().value
        if (oldest !== undefined) positions.current.delete(oldest)
      }
    })
    const rememberScroll = () => {
      const position = positions.current.get(entryKey)
      positions.current.set(entryKey, { ...position, y: window.scrollY })
    }
    window.addEventListener('scroll', rememberScroll, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', rememberScroll)
    }
  }, [catalog.isSuccess, entryKey, legacyId, navigationType, pinId])

  const trackOpen = useCallback((material: Material) => {
    positions.current.set(entryKey, { y: window.scrollY, materialId: material.id })
    signal(material, 'open')
  }, [entryKey, signal])

  const detail = useMemo(() => pinId ? all?.find((material) => material.id === pinId) : undefined, [all, pinId])
  const byId = useMemo(() => new Map(all?.map((item) => [item.id, item])), [all])
  const searchIndex = useMemo(() => new Map(all?.map((item) => [item.id, searchable(item)])), [all])
  const displayed = useMemo(() => {
    if (pinId) return detail && all ? similarTo(detail, all, library.hidden) : []
    const terms = normalized(query).split(/\s+/).filter(Boolean)
    const hidden = new Set(library.hidden)
    const pool = savedView ? library.saved.flatMap((id) => byId.get(id) ?? []) : (all ?? [])
    return pool.filter((material) => (savedView || !hidden.has(material.id)) &&
      terms.every((token) => searchIndex.get(material.id)?.includes(token)))
  }, [all, byId, detail, library.hidden, library.saved, pinId, query, savedView, searchIndex])

  const resultKey = `${entryKey}:${seed}:${query}`
  const rememberResults = useCallback((progress: ResultProgress) => {
    const history = resultsHistory.current
    history.set(resultKey, progress)
    if (history.size > historyLimit) {
      const oldest = history.keys().next().value
      if (oldest !== undefined) history.delete(oldest)
    }
  }, [resultKey])

  const setQuery = (text: string) => {
    const target = new URLSearchParams()
    if (text) target.set('q', text)
    const currentPath = window.location.pathname
    navigate({ pathname: currentPath === '/saved' ? '/saved' : '/', search: target.toString() },
      { replace: !currentPath.startsWith('/pin/') })
  }
  const clearQuery = () => {
    setQuery('')
    search.current?.focus()
  }
  const back = () => {
    if (location.state?.relayBack) navigate(-1)
    else navigate('/', { replace: true })
  }

  if (legacyId) return <Navigate replace to={pinPath(legacyId)} />

  const featured = detail && <Detail material={detail} saved={library.saved.includes(detail.id)}
    hidden={library.hidden.includes(detail.id)} audioRef={detailAudio} onBack={back}
    onSave={save} onPlay={() => {
      stopPreview()
      signal(detail, 'play')
    }} onLess={() => {
      hide(detail)
      back()
    }} />
  const results = (displayed.length > 0 || detail) && <Results key={resultKey} featured={featured}
    candidates={displayed} ordered={!!pinId || savedView} seed={seed}
    watch={!preferences && !savedView && library.personalize}
    eclectic={!query && !pinId && !savedView}
    live={live} saved={library.saved} playing={playing}
    history={resultsHistory} historyKey={resultKey} onProgress={rememberResults}
    onOpen={trackOpen} onSave={save} onPreview={preview} onSignal={signal} />

  return <div className="relay-discovery">
    <a className="skip-link" href="#discovery">К содержимому</a>
    <header className="relay-topbar">
      <div className="relay-top-inner">
        <NavLink to="/" end className="relay-home-link" aria-label="Relay — лента">Relay</NavLink>
        <form className="relay-search" role="search" onSubmit={(event) => {
          event.preventDefault()
          search.current?.blur()
        }}>
          <Search size={18} strokeWidth={1.8} aria-hidden="true" />
          <input type="search" ref={search} value={queryText} aria-label="Поиск фото, музыки и кино"
            onChange={(event) => setQuery(event.target.value)} placeholder="Искать фото, музыку и кино" maxLength={100} />
          {queryText && <button type="button" aria-label="Очистить поиск" onClick={clearQuery}><X size={16} /></button>}
        </form>
        <nav className="relay-main-nav" aria-label="Навигация">
          <NavLink to="/saved" aria-label="Сохранённое"><Bookmark size={18} aria-hidden="true" /><span>Сохранённое</span></NavLink>
          <button className="relay-nav-settings" type="button" aria-label="Настройки ленты" title="Настройки ленты" aria-haspopup="dialog"
            onClick={() => setPreferences(true)}><Settings2 size={19} /></button>
        </nav>
      </div>
    </header>
    <main id="discovery" className="relay-board" tabIndex={-1} ref={main}>
      {!pinId && (savedView || query) && <div className="relay-board-head">
        <h1>{savedView ? 'Сохранённое' : 'Поиск'}</h1>
        {catalog.isSuccess && displayed.length > 0 && <p role="status">Материалов — {displayed.length.toLocaleString('ru-RU')}</p>}
      </div>}
      {!pinId && !savedView && !query && <h1 className="visually-hidden">Лента</h1>}
      {catalog.isPending && <div role="status">
        <span className="visually-hidden">Загружаем материалы…</span>
        <div className={pinId ? 'relay-loading relay-loading-pin' : 'relay-loading'} aria-hidden="true">
          <div /><div /><div /><div /><div /><div /><div /><div /><div />
        </div>
      </div>}
      {catalog.isError && <div className="relay-empty" role="alert">
        <h2>Материалы временно недоступны</h2>
        <p>Попробуйте загрузить ленту ещё раз.</p>
        <button className="relay-primary" disabled={catalog.isFetching} onClick={() => void catalog.refetch()}>
          {catalog.isFetching ? 'Загружаем…' : 'Повторить загрузку'}
        </button>
      </div>}
      {catalog.isSuccess && (pinId ? (detail ? results : <div className="relay-empty">
        <h1>Материал недоступен</h1>
        <p>Проверьте ссылку или вернитесь к ленте.</p>
        <button className="relay-quiet" onClick={back}>Назад</button>
      </div>)
        : results || <div className="relay-empty">
          <h2>{query ? `По запросу «${query}» ничего не нашлось` : savedView ? 'Здесь пока пусто' : 'Лента пока пуста'}</h2>
          {query ? <>
            <p>Попробуйте название, имя автора или тему.</p>
            <button className="relay-quiet" onClick={clearQuery}>Очистить запрос</button>
          </> : savedView ? <>
            <p>Нажмите на значок закладки на карточке. Материал появится здесь.</p>
            <Link className="relay-primary" to="/">Смотреть ленту</Link>
          </> : <button className="relay-quiet" onClick={() => setPreferences(true)}>Настройки ленты</button>}
        </div>)}
    </main>
    {notice && <Notice key={notice.text + notice.undo} notice={notice} onUndo={undo} onDismiss={dismiss} />}
    {preferences && <Preferences library={library} onClose={() => setPreferences(false)} onToggle={() => {
      toggle()
      setSeed(newSeed())
    }} onReset={() => {
      reset()
      setSeed(newSeed())
      window.scrollTo(0, 0)
      setPreferences(false)
    }} />}
  </div>
}
