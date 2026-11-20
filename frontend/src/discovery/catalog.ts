import type { Person } from '../api/types'

export type Kind = 'image' | 'track' | 'film' | 'video'
export type Topic = 'nature' | 'city' | 'architecture' | 'food' | 'wildlife' | 'people' | 'art' | 'cinema' | 'sound'

export interface Material {
  id: string
  kind: Kind
  topic: Topic
  title: string
  originalTitle?: string
  creator: string
  credit: string
  source: string
  license: string
  licenseUrl: string | null
  description: string
  image: string | null
  thumbnail?: string | null
  preview?: string
  audio: string | null
  audioType: string | null
  video?: string | null
  author?: Person
  excerpt?: boolean
  ratio: number
  year: number | null
  tags: string[]
  colors?: string[]
  light?: string
  placeholder?: string
  featured?: number
}

export const kindNames: Record<Kind, string> = { image: 'Фото и изображения', track: 'Музыка', film: 'Кино', video: 'Видео' }
export const topicNames: Record<Topic, string> = {
  nature: 'Природа', city: 'Город', architecture: 'Архитектура', food: 'Еда',
  wildlife: 'Животные', people: 'Люди', art: 'Искусство', cinema: 'Постеры', sound: 'Записи',
}
const aliases: Record<Topic, string> = {
  nature: 'nature landscape mountains outdoors forest woods travel', city: 'city urban street cities town',
  architecture: 'architecture building interior facade home', food: 'food coffee cuisine drink',
  wildlife: 'wildlife animals birds mammals nature', people: 'people portrait sport person',
  art: 'art painting museum fine-art graphics archive', cinema: 'cinema movie film poster',
  sound: 'music audio piano track',
}
const kindAliases = { image: 'изображение картинка фото фотография photo image picture',
  track: 'музыка трек аудио запись слушать piano track', film: 'кино фильм постер плакат cinema film poster',
  video: 'видео ролик video' }

export function normalized(value: string) {
  return value.toLocaleLowerCase().normalize('NFKC').replace(/ё/g, 'е').trim()
}

export function searchable(material: Material) {
  return normalized([
    material.title, material.originalTitle, material.creator, material.description, kindAliases[material.kind],
    topicNames[material.topic], aliases[material.topic], ...material.tags, material.year,
  ].filter(Boolean).join(' '))
}

export function displayTitle(material: Material) {
  if (material.author) return material.title
  const short = material.title.replace(/\.(?:jpe?g|png|webp|oga|ogg|mp3|flac)$/i, '')
    .replace(/_/g, ' ').trim()
  return short || kindNames[material.kind]
}

export function pinPath(id: string) {
  return `/pin/${encodeURIComponent(id)}`
}

export function artRatio(material: Material) {
  if (material.kind === 'track') return 1.28
  if (material.kind === 'film') return Math.max(.65, Math.min(.96, material.ratio))
  return Math.min(1.78, Math.max(.65, material.ratio))
}

export function hash(value: string) {
  let state = 2166136261
  for (let i = 0; i < value.length; i++) {
    state = Math.imul(state ^ value.charCodeAt(i), 16777619)
  }
  return (state >>> 0) / 4294967296
}

export async function loadCatalog(signal: AbortSignal): Promise<Material[]> {
  const response = await fetch('/discovery/catalog.json', { signal })
  if (!response.ok) throw new Error('Лента временно недоступна')
  const items: unknown = await response.json()
  if (!Array.isArray(items)) throw new Error('Лента временно недоступна')
  return items as Material[]
}
