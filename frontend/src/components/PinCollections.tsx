import { useQueryClient } from '@tanstack/react-query'
import { FolderPlus, LockKeyhole } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { send } from '../api/client'
import { usePinCollections, type PinCollection } from '../api/pins'
import type { Account } from '../api/types'
import { Feedback, Loading, Modal } from './UI'

export function CollectionForm({ collection, onSaved }: {
  collection?: PinCollection; onSaved: (result: PinCollection) => void
}) {
  const cache = useQueryClient()
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setPending(true)
    setError(undefined)
    try {
      const result = await send<PinCollection>(collection ? `/pin-collections/${collection.id}` : '/pin-collections',
        collection ? 'PUT' : 'POST', {
          title: fields.get('title'), description: fields.get('description'), public: fields.has('public'),
        })
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['pin-collections'] }),
        cache.invalidateQueries({ queryKey: ['pin-collection'] }),
      ])
      onSaved(result)
    } catch (cause) { setError(cause) }
    finally { setPending(false) }
  }
  return <form className="form-stack" onSubmit={submit}>
    <label>Название<input name="title" defaultValue={collection?.title} maxLength={120} required /></label>
    <label>Описание<textarea name="description" defaultValue={collection?.description} maxLength={600} rows={3} /></label>
    <label className="pin-visibility"><input name="public" type="checkbox" defaultChecked={collection?.public} /> Публичная папка</label>
    <Feedback error={error} />
    <button className="button primary" disabled={pending}>{collection ? 'Сохранить изменения' : 'Создать папку'}</button>
  </form>
}

export function SaveToCollection({ materialId, account }: { materialId: string; account?: Account | null }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<PinCollection>()
  const guestHref = `/login?${new URLSearchParams({ next: pathname })}`
  return <>
    {account ? <button className="relay-quiet" onClick={() => { setSaved(undefined); setOpen(true) }}><FolderPlus size={17} /> В папку</button>
      : <Link className="relay-quiet" to={guestHref}><FolderPlus size={17} /> В папку</Link>}
    {saved && <span className="pin-save-status" role="status">Сохранено в папку <Link to={`/folder/${saved.id}`}>{saved.title}</Link></span>}
    {open && account && <CollectionPicker username={account.username} materialId={materialId}
      onClose={() => setOpen(false)} onSaved={(collection) => { setOpen(false); setSaved(collection) }} />}
  </>
}

function CollectionPicker({ username, materialId, onClose, onSaved }: {
  username: string; materialId: string; onClose: () => void; onSaved: (collection: PinCollection) => void
}) {
  const query = usePinCollections(username)
  const cache = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  const collections = query.data?.pages.flatMap((page) => page.items) ?? []

  async function save(collection: PinCollection) {
    setPending(true)
    setError(undefined)
    try {
      await send(`/pin-collections/${collection.id}/pins/${encodeURIComponent(materialId)}`, 'PUT')
      await cache.invalidateQueries({ queryKey: ['pin-collection', `/pin-collections/${collection.id}`] })
      onSaved(collection)
    } catch (cause) { setError(cause) }
    finally { setPending(false) }
  }

  return <Modal title={creating ? 'Новая папка' : 'Сохранить в папку'} onClose={onClose}>
    {creating ? <CollectionForm onSaved={(collection) => { setCreating(false); void save(collection) }} /> : <div className="pin-picker">
      {query.isPending && <Loading />}
      {collections.map((collection) => <button key={collection.id} className="button" disabled={pending}
        onClick={() => void save(collection)}>{!collection.public && <LockKeyhole size={16} />}{collection.title}</button>)}
      {query.hasNextPage && <button className="button quiet" disabled={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}>Ещё папки</button>}
      <button className="button primary" disabled={pending} onClick={() => setCreating(true)}><FolderPlus size={17} /> Новая папка</button>
      <Feedback error={error || query.error} />
    </div>}
  </Modal>
}
