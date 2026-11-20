import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Folder, FolderPlus, LockKeyhole, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, send } from '../api/client'
import { usePinCollections, type CollectionDetail, type CollectionEntry } from '../api/pins'
import { usePage, useSession } from '../api/queries'
import { CollectionForm } from '../components/PinCollections'
import { Empty, Feedback, Loading, Modal } from '../components/UI'
import { displayTitle, pinPath, type Material } from '../discovery/catalog'
import { MediaVisual } from '../discovery/MaterialCard'
import './pins.css'

const formats = {
  image: { label: 'Фото', accept: '.jpg,.jpeg,.png,.webp', help: 'JPEG, PNG или WebP до 10 МБ', limit: 10 },
  track: { label: 'Аудио', accept: '.mp3,.wav,.ogg,.flac', help: 'MP3, WAV, OGG или FLAC до 50 МБ', limit: 50 },
  video: { label: 'Видео', accept: '.mp4,.webm', help: 'MP4 или WebM до 50 МБ', limit: 50 },
}

export function NewPinPage() {
  const session = useSession()
  const cache = useQueryClient()
  const navigate = useNavigate()
  const [kind, setKind] = useState<keyof typeof formats>('image')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  if (session.isPending) return <Loading />
  if (session.isError) return <Feedback error={session.error} />
  if (!session.data) return <Navigate replace to="/login?next=%2Fcreate-pin" />
  const format = formats[kind]

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = new FormData(event.currentTarget)
    const file = body.get('file') as File
    const cover = body.get('cover') as File | null
    if (!cover?.size) body.delete('cover')
    setError(undefined)
    if (file.size > format.limit * 1024 ** 2 || (cover && cover.size > 10 * 1024 ** 2)) {
      setError(new Error(`Максимальный размер файла — ${format.limit} МБ, обложки — 10 МБ`))
      return
    }
    setPending(true)
    try {
      const pin = await api<Material>('/pins', { method: 'POST', body })
      await cache.invalidateQueries({ queryKey: ['pins'] })
      navigate(pinPath(pin.id), { replace: true })
    } catch (cause) { setError(cause) }
    finally { setPending(false) }
  }

  return <section className="panel form-page pin-form">
    <h1>Создать пин</h1>
    <p>Пин появится в вашем профиле и общей ленте.</p>
    <form className="form-stack" onSubmit={publish}>
      <label>Тип пина<select name="kind" value={kind} disabled={pending} onChange={(event) => setKind(event.target.value as keyof typeof formats)}>
        {Object.entries(formats).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
      </select></label>
      <label>Файл<input key={kind} name="file" type="file" accept={format.accept} required /><small>{format.help}</small></label>
      {kind !== 'image' && <label>Обложка <input name="cover" type="file" accept={formats.image.accept} /><small>По желанию. {formats.image.help}.</small></label>}
      <label>Название<input name="title" maxLength={160} required /></label>
      <label>Описание<textarea name="description" maxLength={2000} rows={4} /></label>
      <Feedback error={error} />
      <button className="button primary" disabled={pending}>{pending ? 'Публикуем…' : 'Опубликовать'}</button>
    </form>
  </section>
}

function PinTile({ material, children }: { material: Material; children?: ReactNode }) {
  return <article className="pin-tile">
    <Link to={pinPath(material.id)} state={{ relayBack: true }}>
      <div className="pin-tile-visual"><MediaVisual material={material} /></div>
      <h3>{displayTitle(material)}</h3>
    </Link>
    {children}
  </article>
}

export function ProfilePins({ username, own }: { username: string; own: boolean }) {
  const query = usePage<Material>('pins', `/profiles/${username}/pins`)
  const pins = query.data?.pages.flatMap((page) => page.items) ?? []
  return <section>
    <div className="section-heading"><h2>Пины</h2>{own && <Link className="button primary" to="/create-pin"><Plus size={17} /> Создать пин</Link>}</div>
    <Feedback error={query.error} />
    {query.isPending && <Loading />}
    {query.isSuccess && !pins.length && <Empty title="Пинов пока нет" />}
    {!!pins.length && <div className="pin-tiles">{pins.map((pin) => <PinTile key={pin.id} material={pin} />)}</div>}
    {query.hasNextPage && <div className="more"><button className="button" disabled={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}>Ещё пины</button></div>}
  </section>
}

export function ProfileCollections({ username, own }: { username: string; own: boolean }) {
  const query = usePinCollections(username)
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const folders = query.data?.pages.flatMap((page) => page.items) ?? []
  return <section>
    <div className="section-heading"><h2>Папки</h2>{own && <button className="button primary"
      onClick={() => setCreating(true)}><FolderPlus size={17} /> Новая папка</button>}</div>
    <Feedback error={query.error} />
    {query.isPending && <Loading />}
    {query.isSuccess && !folders.length && <Empty title="Папок пока нет" />}
    {!!folders.length && <div className="pin-tiles">{folders.map((folder) => <Link className="pin-folder" key={folder.id} to={`/folder/${folder.id}`}>
      <Folder size={24} /><div><h3>{folder.title}</h3>{folder.description && <p>{folder.description}</p>}</div>
      {!folder.public && <LockKeyhole size={16} aria-label="Личная папка" />}
    </Link>)}</div>}
    {query.hasNextPage && <div className="more"><button className="button" disabled={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}>Ещё папки</button></div>}
    {creating && <Modal title="Новая папка" onClose={() => setCreating(false)}>
      <CollectionForm onSaved={(folder) => navigate(`/folder/${folder.id}`)} />
    </Modal>}
  </section>
}

export function CollectionPage() {
  const { collectionId = '' } = useParams()
  return <CollectionView key={collectionId} id={collectionId} />
}

function CollectionView({ id }: { id: string }) {
  const path = `/pin-collections/${id}`
  const query = usePage<CollectionEntry>('pin-collection', path)
  const session = useSession()
  const cache = useQueryClient()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  const data = query.data?.pages[0] as CollectionDetail | undefined
  if (query.isPending) return <Loading />
  if (!data) return <Empty title="Папка недоступна"><Feedback error={query.error} /></Empty>
  const collection = data.collection
  const own = session.data?.id === collection.owner.id
  const back = `/u/${collection.owner.username}?tab=folders`
  const entries = query.data?.pages.flatMap((page) => page.items) ?? []

  async function remove(entry?: CollectionEntry) {
    setPending(true)
    setError(undefined)
    try {
      await send(entry ? `${path}/pins/${entry.id}` : path, 'DELETE')
      if (entry) await query.refetch()
      else {
        void cache.invalidateQueries({ queryKey: ['pin-collections'] })
        navigate(back, { replace: true })
      }
    } catch (cause) { setError(cause) }
    finally { setPending(false) }
  }

  return <section className="pin-folder-page">
    <Link to={back} className="button quiet"><ArrowLeft size={17} /> Папки @{collection.owner.username}</Link>
    <div className="section-heading">
      <div><h1>{collection.title}</h1>{!collection.public && <span className="subtle-label"><LockKeyhole size={14} /> Личная папка</span>}
        {collection.description && <p>{collection.description}</p>}</div>
      {own && <div className="inline-actions">
        <button className="button" onClick={() => setEditing(true)}><Pencil size={17} /> Редактировать</button>
        <button className="button" onClick={() => { setError(undefined); setDeleting(true) }}><Trash2 size={17} /> Удалить папку</button>
      </div>}
    </div>
    <Feedback error={deleting ? null : error || query.error} />
    {!entries.length && <Empty title="Папка пока пуста">{own && <p>Откройте пин в ленте и нажмите «В папку».</p>}
      <Link className="button" to="/">В ленту</Link></Empty>}
    {!!entries.length && <div className="pin-tiles">{entries.map((entry) => {
      const action = own && <button className="button quiet" disabled={pending}
        aria-label={`Убрать из папки: ${entry.material ? displayTitle(entry.material) : 'недоступный пин'}`}
        onClick={() => void remove(entry)}><Trash2 size={16} /> Убрать из папки</button>
      return entry.material ? <PinTile key={entry.id} material={entry.material}>{action}</PinTile>
        : <article className="pin-tile" key={entry.id}><p>Пин недоступен</p>{action}</article>
    })}</div>}
    {query.hasNextPage && <div className="more"><button className="button" disabled={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}>Ещё пины</button></div>}
    {editing && <Modal title="Редактировать папку" onClose={() => setEditing(false)}>
      <CollectionForm collection={collection} onSaved={() => setEditing(false)} />
    </Modal>}
    {deleting && <Modal title="Удалить папку?" onClose={() => setDeleting(false)}>
      <div className="form-stack"><p>Пины останутся доступны в ленте.</p><Feedback error={error} />
        <button className="button danger" disabled={pending} onClick={() => void remove()}>Удалить папку</button></div>
    </Modal>}
  </section>
}
