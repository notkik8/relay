export type MediaKind = 'track' | 'film' | 'image'
export type Visibility = 'public' | 'link' | 'private'
export type Theme = 'blue' | 'amber' | 'violet' | 'moss' | 'rose' | 'slate'

export interface Person {
  id: string
  name: string
  username: string
  bio: string
  avatar_url: string | null
}

export interface Account extends Person {
  email: string
  admin: boolean
}

export interface BoardInput {
  title: string
  description: string
  visibility: Visibility
  tags: string[]
  theme: Theme
}

export interface Board extends BoardInput {
  key: string
  version: number
  author: Pick<Person, 'username' | 'name'>
  cover_url: string | null
  counts: Record<MediaKind, number>
  likes: number
  liked: boolean
  comments: number
  created_at: string
  owned: boolean
  editable: boolean
}

export interface CatalogEntry {
  external_id: string
  title: string
  kind: 'track' | 'film'
  creator: string
  year: number | null
  provider: string
  artwork: string | null
}

export interface Item extends Omit<CatalogEntry, 'external_id' | 'kind'> {
  id: string
  kind: MediaKind
  position: number
  note: string
  tags: string[]
  likes: number
  liked: boolean
  preview: string | null
  original: string | null
  source: string
}

export interface Page<T> {
  items: T[]
  next_offset: number | null
}

export interface BoardItems extends Page<Item> {
  tags: string[]
  version: number
}

export interface Comment {
  id: string
  text: string
  author: Person
  created_at: string
  owned: boolean
}

export interface Notice {
  id: string
  type: 'follow' | 'invite' | 'like' | 'comment'
  actor: Person
  read: boolean
  created_at: string
  board_title: string | null
  board_key: string | null
  object_id: string | null
  pending: boolean
}
