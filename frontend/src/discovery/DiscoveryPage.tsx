import { useQuery } from '@tanstack/react-query'
import { Bookmark, Images, Plus, Settings2, Search, UserRound, X } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Navigate, useLocation, useMatch, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { loadSavedPins } from '../api/pins'
import { usePage, useSession } from '../api/queries'
import { Avatar } from '../components/UI'
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
  const publishedView = location.pathname === '/published'
  const pinId = useMatch('/pin/:materialId')?.params.materialId
  const legacyId = pinId ? null : params.get('m')
  const queryText = pinId ? '' : params.get('q') ?? ''
  const deferred = useDeferredValue(queryText)
  const query = deferred.trim()
  const catalog = useQuery({ queryKey: ['discovery'], queryFn: ({ signal }) => loadCatalog(signal),
    staleTime: Infinity, retry: false, enabled: !publishedView })
  const account = useSession().data
  const { library, live, signal, save, hide, notify, notice, dismiss, undo, toggle, reset } = useDiscoveryLibrary()
  const published = usePage<Material>('pins', query ? `/pins?${new URLSearchParams({ q: query })}` : '/pins', !savedView && !pinId)
  const direct = !!pinId?.startsWith('p-')
  const uploaded = useQuery({ queryKey: ['pin', pinId], enabled: direct, retry: false,
    queryFn: ({ signal }) => api<Material>(`/pins/${encodeURIComponent(pinId ?? '')}`, { signal }) })
  const savedIds = useMemo(() => library.saved.filter((id) => id.startsWith('p-')), [library.saved])
  const savedPins = useQuery({ queryKey: ['saved-pins', savedIds], enabled: savedView && !!savedIds.length,
    queryFn: ({ signal }) => loadSavedPins(savedIds, signal), retry: false })
  const publications = useMemo(() => {
    const pages = published.data?.pages ?? []
    const pins = (publishedView ? pages : pages.slice(0, 1)).flatMap((page) => page.items)
    return [...new Map(pins.map((pin) => [pin.id, pin])).values()]
  }, [published.data, publishedView])
  const all = useMemo(() => [...(catalog.data ?? []), ...(savedView ? (savedPins.data ?? []) : publications)],
    [catalog.data, publications, savedPins.data, savedView])
  const waiting = pinId ? (direct ? uploaded.isPending : catalog.isPending)
    : (catalog.isPending && !publishedView) || (!savedView && published.isPending) || (savedView && !!savedIds.length && savedPins.isPending)
  const loadError = pinId ? (direct ? uploaded.isError && !(uploaded.error instanceof ApiError && uploaded.error.status === 404)
    : catalog.isError) : publishedView ? published.isError && !publications.length
    : catalog.isError && !publications.length && !savedPins.data?.length
  const [seed, setSeed] = useState(newSeed)
  const [preferences, setPreferences] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const main = useRef<HTMLElement>(null)
  const positions = useRef(new Map<string, Position>())
  const resultsHistory = useRef(new Map<string, ResultProgress>())
  const detailAudio = useRef<HTMLAudioElement>(null)
  const detailVideo = useRef<HTMLVideoElement>(null)
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
    detailVideo.current?.pause()
    const audio = new Audio(material.audio)
    player.current = { material, audio }
    setPlaying(material.id)
    const failed = () => {
      if (player.current?.audio !== audio) return
      stopPreview()
      notify(material.author ? 'Не удалось воспроизвести аудио.' : 'Запись не загрузилась. Её можно открыть у источника.')
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
    if (waiting || legacyId) return
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
  }, [waiting, entryKey, legacyId, navigationType, pinId])

  const trackOpen = useCallback((material: Material) => {
    positions.current.set(entryKey, { y: window.scrollY, materialId: material.id })
    signal(material, 'open')
  }, [entryKey, signal])

  const detail = direct ? uploaded.data : pinId ? catalog.data?.find((material) => material.id === pinId) : undefined
  const byId = useMemo(() => new Map(all?.map((item) => [item.id, item])), [all])
  const searchIndex = useMemo(() => new Map(all?.map((item) => [item.id, searchable(item)])), [all])
  const displayed = useMemo(() => {
    if (pinId) return detail ? similarTo(detail, all, library.hidden) : []
    const terms = normalized(query).split(/\s+/).filter(Boolean)
    const hidden = new Set(library.hidden)
    const pool = savedView ? library.saved.flatMap((id) => byId.get(id) ?? []) : publishedView ? publications : all
    return pool.filter((material) => (savedView || !hidden.has(material.id)) &&
      ((!savedView && material.author) || terms.every((token) => searchIndex.get(material.id)?.includes(token))))
  }, [all, byId, detail, library.hidden, library.saved, pinId, publications, publishedView, query, savedView, searchIndex])

  const newest = !savedView && !pinId && !publishedView ? displayed.filter((item) => item.author).slice(0, 4) : []
  const resultKey = `${entryKey}:${seed}:${query}:${newest.map((item) => item.id).join(',')}`
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
    navigate({ pathname: currentPath === '/saved' || currentPath === '/published' ? currentPath : '/', search: target.toString() },
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

  const featured = detail && <Detail key={detail.id} material={detail} account={account} saved={library.saved.includes(detail.id)}
    hidden={library.hidden.includes(detail.id)} audioRef={detailAudio} videoRef={detailVideo} onBack={back}
    onSave={save} onPlay={() => {
      stopPreview()
      signal(detail, 'play')
    }} onLess={() => {
      hide(detail)
      back()
    }} />
  const results = (displayed.length > 0 || detail) && <Results key={resultKey} featured={featured}
    candidates={displayed} ordered={!!pinId || savedView || publishedView} newest={newest} seed={seed}
    watch={!preferences && !savedView && library.personalize}
    eclectic={!query && !pinId && !savedView && !publishedView}
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
          <NavLink to={queryText ? `/published?${new URLSearchParams({ q: queryText })}` : '/published'} aria-label="Публикации" title="Публикации">
            <Images size={18} aria-hidden="true" />
          </NavLink>
          <NavLink to="/saved" aria-label="Сохранённое"><Bookmark size={18} aria-hidden="true" /><span>Сохранённое</span></NavLink>
          <Link to={account ? '/create-pin' : '/login?next=%2Fcreate-pin'} aria-label="Создать пин" title="Создать пин"><Plus size={20} /></Link>
          <button className="relay-nav-settings" type="button" aria-label="Настройки ленты" title="Настройки ленты" aria-haspopup="dialog"
            onClick={() => setPreferences(true)}><Settings2 size={19} /></button>
          {account ? <Link to={`/u/${account.username}`} aria-label="Мой профиль" title="Мой профиль"><Avatar person={account} size="small" /></Link>
            : <Link to={`/login?${new URLSearchParams({ next: location.pathname + location.search })}`} aria-label="Войти" title="Войти"><UserRound size={18} /><span>Войти</span></Link>}
        </nav>
      </div>
    </header>
    <main id="discovery" className="relay-board" tabIndex={-1} ref={main}>
      {!pinId && (savedView || query || publishedView) && <div className="relay-board-head">
        <h1>{savedView ? 'Сохранённое' : publishedView ? 'Публикации' : 'Поиск'}</h1>
        {!waiting && !published.hasNextPage && displayed.length > 0 && <p role="status">Материалов — {displayed.length.toLocaleString('ru-RU')}</p>}
      </div>}
      {!pinId && !savedView && !query && !publishedView && <h1 className="visually-hidden">Лента</h1>}
      {waiting && <div role="status">
        <span className="visually-hidden">Загружаем материалы…</span>
        <div className={pinId ? 'relay-loading relay-loading-pin' : 'relay-loading'} aria-hidden="true">
          <div /><div /><div /><div /><div /><div /><div /><div /><div />
        </div>
      </div>}
      {!waiting && loadError && <div className="relay-empty" role="alert">
        <h2>Материалы временно недоступны</h2>
        <p>Попробуйте загрузить ленту ещё раз.</p>
        <button className="relay-primary" onClick={() => void (direct ? uploaded.refetch() : publishedView ? published.refetch() : catalog.refetch())}>
          Повторить загрузку
        </button>
      </div>}
      {!waiting && !loadError && (pinId ? (detail ? results : <div className="relay-empty">
        <h1>Материал недоступен</h1>
        <p>Проверьте ссылку или вернитесь к ленте.</p>
        <button className="relay-quiet" onClick={back}>Назад</button>
      </div>)
        : results || <div className="relay-empty">
          <h2>{query ? `По запросу «${query}» ничего не нашлось` : savedView ? 'Здесь пока пусто' : publishedView ? 'Публикаций пока нет' : 'Лента пока пуста'}</h2>
          {query ? <>
            <p>Попробуйте название, имя автора или тему.</p>
            <button className="relay-quiet" onClick={clearQuery}>Очистить запрос</button>
          </> : savedView ? <>
            <p>Нажмите на значок закладки на карточке. Материал появится здесь.</p>
            <Link className="relay-primary" to="/">Смотреть ленту</Link>
          </> : publishedView ? <Link className="relay-primary" to={account ? '/create-pin' : '/login?next=%2Fcreate-pin'}>Создать пин</Link>
            : <button className="relay-quiet" onClick={() => setPreferences(true)}>Настройки ленты</button>}
        </div>)}
      {publishedView && published.hasNextPage && <div className="relay-more">
        <button className="relay-quiet" disabled={published.isFetchingNextPage} onClick={() => void published.fetchNextPage()}>
          {published.isFetchingNextPage ? 'Загружаем…' : 'Ещё публикации'}
        </button>
      </div>}
      {publishedView && published.isFetchNextPageError && <p role="alert">Не удалось загрузить следующую страницу.</p>}
      {savedView && savedPins.isError && <p role="alert">Не удалось загрузить сохранённые публикации.</p>}
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
