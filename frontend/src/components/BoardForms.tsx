import { tagsFrom, themeLabels, visibilityLabels } from './format'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Link2, Plus, Search, Upload } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api, send, upload } from '../api/client'
import type { Board, BoardInput, CatalogEntry, MediaKind, Theme, Visibility } from '../api/types'
import { Artwork, Feedback, Loading, MediaIcon } from './UI'

export function BoardForm({ initial, onSave, action = 'Сохранить изменения' }: {
  initial?: Board; onSave: (data: BoardInput) => Promise<void>; action?: string
}) {
  const [theme, setTheme] = useState<Theme>(initial?.theme ?? 'blue')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setPending(true)
    setError(undefined)
    try {
      await onSave({
        title: String(data.get('title')).trim(), description: String(data.get('description') ?? '').trim(),
        visibility: (data.get('visibility') ?? 'private') as Visibility, theme,
        tags: tagsFrom(String(data.get('tags') ?? '')),
      })
    } catch (cause) { setError(cause) }
    finally { setPending(false) }
  }

  return <form className="form-stack" onSubmit={submit}>
    <label>Название<input name="title" required maxLength={120} defaultValue={initial?.title}
      placeholder="Например, Осенний вечер" /></label>
    {initial && <>
      <label>Описание<textarea name="description" rows={3} maxLength={2000} defaultValue={initial.description} /></label>
      <label>Теги<input name="tags" defaultValue={initial.tags.join(', ')} placeholder="Кино, музыка, осень" />
        <small>Разделяйте теги запятыми.</small></label>
      <label>Видимость<select name="visibility" defaultValue={initial.visibility}>
        {(Object.entries(visibilityLabels) as [Visibility, string][]).map(([key, name]) =>
          <option key={key} value={key}>{name}</option>)}
      </select><small>Приватную доску видят владелец и приглашённые редакторы. Доску по ссылке может открыть любой, у кого она есть.</small></label>
      <fieldset className="themes">
        <legend>Цвет обложки</legend>
        {Object.entries(themeLabels).map(([key, title]) =>
          <button type="button" key={key} aria-pressed={key === theme} aria-label={title}
            className={`swatch art-${key}`} onClick={() => setTheme(key as Theme)}>{key === theme && <Check size={17} />}</button>)}
      </fieldset>
    </>}
    <Feedback error={error} />
    <button type="submit" className="button primary" disabled={pending}>
      {pending ? 'Сохраняем…' : action} <ArrowRight size={17} />
    </button>
  </form>
}

export function AddMedia({ boardKey, onAdded }: { boardKey: string; onAdded: () => Promise<void> }) {
  const [kind, setKind] = useState<MediaKind>('track')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState('')
  const [imageMode, setImageMode] = useState<'upload' | 'import'>('upload')
  const results = useQuery({
    queryKey: ['catalog', kind, query],
    queryFn: ({ signal }) => api<CatalogEntry[]>(`/catalog/${kind}?q=${encodeURIComponent(query)}`, { signal }),
    enabled: kind !== 'image' && !!query,
    retry: false,
  })
  const endpoint = `/boards/${boardKey}/items`

  function switchKind(next: MediaKind) {
    setKind(next)
    setQuery('')
    setError(undefined)
    setStatus('')
  }

  async function add(operation: () => Promise<unknown>, title: string) {
    setPending(true)
    setError(undefined)
    setStatus('')
    try {
      await operation()
      setStatus(`Добавлено · ${title}`)
      await onAdded()
      return true
    } catch (cause) { setError(cause) }
    finally { setPending(false) }
    return false
  }

  async function imageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const file = data.get('file')
    const title = String(data.get('title') ?? '').trim() ||
      (file instanceof File ? file.name.replace(/\.[^.]+$/, '').slice(0, 160) : 'Изображение')
    const success = await add(
      () => file instanceof File ? upload(`${endpoint}/upload`, 'POST', file, title) :
        send(`${endpoint}/import`, 'POST', { url: data.get('url'), title }), title,
    )
    if (success) form.reset()
  }

  return <div className="form-stack">
    <div className="segmented" aria-label="Тип медиа">
      {(['track', 'film', 'image'] as const).map((value) => <button key={value} type="button"
        disabled={pending} aria-pressed={value === kind} onClick={() => switchKind(value)}>
        <MediaIcon kind={value} />{{ track: 'Трек', film: 'Фильм', image: 'Изображение' }[value]}
      </button>)}
    </div>
    {kind === 'image' ? <>
      <div className="inline-actions">
        <button className={`button ${imageMode === 'upload' ? 'selected' : 'quiet'}`} type="button"
          aria-pressed={imageMode === 'upload'} onClick={() => setImageMode('upload')}><Upload size={16}/> С устройства</button>
        <button className={`button ${imageMode === 'import' ? 'selected' : 'quiet'}`} type="button"
          aria-pressed={imageMode === 'import'} onClick={() => setImageMode('import')}><Link2 size={16}/> По ссылке</button>
      </div>
      <form key={imageMode} onSubmit={imageSubmit} className="form-stack">
        {imageMode === 'upload' ? <label>Файл изображения
          <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required />
          <small>JPEG, PNG или WebP · до 10 МБ</small>
        </label> : <label>HTTPS-ссылка на изображение<input type="url" name="url" placeholder="https://" required maxLength={2048} /></label>}
        <label>Название <input name="title" placeholder="Необязательно" maxLength={160} /></label>
        <button className="button primary" disabled={pending}><Plus size={17}/>{pending ? 'Добавляем…' : 'Добавить изображение'}</button>
      </form>
    </> : <>
      <form className="search-form" key={kind} onSubmit={(event) => {
        event.preventDefault()
        setError(undefined)
        setStatus('')
        const value = String(new FormData(event.currentTarget).get('q')).trim()
        if (value === query) void results.refetch()
        else setQuery(value)
      }}>
        <input type="search" name="q" required maxLength={120} aria-label={kind === 'track' ? 'Поиск трека' : 'Поиск фильма'}
          placeholder={kind === 'track' ? 'Трек или исполнитель' : 'Название фильма'} />
        <button className="button primary" aria-label="Искать в каталоге"><Search size={18} /></button>
      </form>
      {query && results.isFetching && <Loading label="Ищем в каталоге…" />}
      <Feedback error={results.error} />
      {results.isError && <button className="button" onClick={() => void results.refetch()}>Повторить поиск</button>}
      {query && results.isSuccess && !results.data.length && <p className="muted">Ничего не найдено.</p>}
      {results.data?.some((entry) => entry.provider === 'demo') && <small className="muted">Демонстрационный каталог</small>}
      <div className="catalog-results">
        {results.data?.map((entry) => <div className="catalog-row" key={entry.external_id}>
          <Artwork url={entry.artwork} theme={entry.kind === 'film' ? 'violet' : 'blue'} kind={kind} />
          <div><strong>{entry.title}</strong><small>{[entry.creator, entry.year].filter(Boolean).join(' · ')}</small></div>
          <button className="button icon-button" aria-label={`Добавить ${entry.title}`} title="Добавить"
            disabled={pending} onClick={() => void add(
              () => send(`${endpoint}/catalog`, 'POST', { kind, external_id: entry.external_id }), entry.title,
            )}><Plus size={20} /></button>
        </div>)}
      </div>
    </>}
    <Feedback error={error}>{status}</Feedback>
  </div>
}

export function FileForm({ label, action, onUpload }: {
  label: string; action: string; onUpload: (file: File) => Promise<unknown>
}) {
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  return <form className="form-stack" onSubmit={async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const file = new FormData(form).get('file')
    if (!(file instanceof File)) return
    setPending(true)
    setError(undefined)
    try { await onUpload(file); form.reset() }
    catch (cause) { setError(cause) }
    finally { setPending(false) }
  }}>
    <label>{label}<input type="file" name="file" accept="image/jpeg,image/png,image/webp" required />
      <small>JPEG, PNG или WebP · до 10 МБ</small>
    </label>
    <button className="button" disabled={pending}>{pending ? 'Загружаем…' : action}</button>
    <Feedback error={error} />
  </form>
}
