import { api } from './client'
import { usePage } from './queries'
import type { Page, Person } from './types'
import type { Material } from '../discovery/catalog'

export interface PinCollection {
  id: string
  owner: Person
  title: string
  description: string
  public: boolean
}

export interface CollectionEntry {
  id: string
  material_id: string
  material: Material | null
}

export interface CollectionDetail extends Page<CollectionEntry> {
  collection: PinCollection
}

export function usePinCollections(username?: string) {
  return usePage<PinCollection>('pin-collections', `/profiles/${username}/pin-collections`, !!username)
}

export async function loadSavedPins(ids: string[], signal: AbortSignal) {
  const pages = []
  for (let index = 0; index < ids.length; index += 60) {
    const params = new URLSearchParams()
    ids.slice(index, index + 60).forEach((id) => params.append('ids', id))
    pages.push(api<Page<Material>>(`/pins?${params}`, { signal }))
  }
  return (await Promise.all(pages)).flatMap((page) => page.items)
}
