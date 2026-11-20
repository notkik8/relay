import { artRatio, hash, normalized, type Kind, type Material } from './catalog'

export type Signal = 'glance' | 'dwell' | 'hover' | 'open' | 'save' | 'play' | 'less'
type Feature = readonly [string, number]

export interface Model {
  weights: Record<string, number>
  updates: number
}
export interface Library {
  saved: string[]
  hidden: string[]
  personalize: boolean
  model: Model
}

const key = 'relay.discovery.v1'
const maxWeights = 1800
const emptyModel = (): Model => ({ weights: Object.create(null) as Record<string, number>, updates: 0 })
const blank = (): Library => ({ saved: [], hidden: [], personalize: true, model: emptyModel() })
const signals: Record<Signal, readonly [target: number, strength: number]> = {
  glance: [0, .045], dwell: [1, .23], hover: [1, .34], open: [1, .85],
  save: [1, 1.65], play: [1, 1.2], less: [0, 1.55],
}
const stops = new Set(('with the and view from near photo photography during street image hdr original ' +
  'file снимок вид фото изображение commons wikimedia photograph summer picture jpg jpeg png ogg').split(' '))

export function readLibrary(): Library {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return blank()
    const saved = JSON.parse(raw)
    const ids = (values: unknown) => Array.isArray(values) ?
      [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length < 50))] : []
    const weights = emptyModel().weights
    if (saved.model?.weights && typeof saved.model.weights === 'object') {
      Object.entries(saved.model.weights).slice(0, maxWeights).forEach(([name, value]) => {
        if (name.includes(':') && typeof value === 'number' && Number.isFinite(value)) {
          weights[name] = Math.min(4, Math.max(-4, value))
        }
      })
    }
    return {
      saved: ids(saved.saved), hidden: ids(saved.hidden).slice(0, 600),
      personalize: saved.personalize !== false,
      model: { weights, updates: Number.isSafeInteger(saved.model?.updates) ? Math.max(0, saved.model.updates) : 0 },
    }
  } catch { return blank() }
}

export function writeLibrary(library: Library) {
  try { localStorage.setItem(key, JSON.stringify(library)) }
  catch { /* Keep the current tab usable when storage is disabled or full. */ }
}

export function resetModel(library: Library): Library {
  return { ...library, model: emptyModel(), hidden: [] }
}

function tokens(material: Material) {
  const text = normalized(material.title)
  return [...new Set(text.match(/[\p{L}]{3,}/gu) ?? [])].filter((word) => !stops.has(word)).slice(0, 8)
}

export function features(material: Material): Feature[] {
  const ratio = artRatio(material)
  const shape = ratio > 1.15 ? 'landscape' : ratio < .87 ? 'portrait' : 'square'
  const selected: Feature[] = [
    [`kind:${material.kind}`, .75], [`topic:${material.topic}`, 1.2],
    [`kind-topic:${material.kind}:${material.topic}`, .53],
    [`shape:${shape}`, .31],
    ...material.tags.map((tag) => [`tag:${normalized(tag)}`, .72] as const),
    ...tokens(material).map((word) => [`word:${word}`, .26] as const),
  ]
  if (material.creator) selected.push([`creator:${normalized(material.creator).slice(0, 60)}`, .26])
  if (material.year && material.year >= 1200) selected.push([`era:${Math.floor(material.year / 25) * 25}`, .42])
  for (const color of material.colors ?? []) selected.push([`color:${color}`, .44])
  if (material.light) selected.push([`light:${material.light}`, .34])
  return selected
}

function logit(model: Model, vector: Feature[]) {
  return vector.reduce((sum, [name, amount]) => sum + (model.weights[name] ?? 0) * amount, 0)
}

export function train(model: Model, material: Material, signal: Signal): Model {
  const vector = features(material)
  const [target, strength] = signals[signal]
  const prediction = 1 / (1 + Math.exp(-logit(model, vector)))
  const squared = vector.reduce((sum, [, amount]) => sum + amount * amount, 0)
  const step = .95 * strength * (target - prediction) / Math.sqrt(squared)
  const weights = { ...model.weights }
  for (const [name, amount] of vector) {
    weights[name] = Math.min(4, Math.max(-4, (weights[name] ?? 0) * .996 + step * amount))
  }
  const pairs = Object.entries(weights)
  const bounded = pairs.length > maxWeights
    ? Object.fromEntries(pairs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, maxWeights))
    : weights
  return { weights: bounded, updates: model.updates + 1 }
}

function diversify(rows: Material[], count: number, offset: number) {
  const ranked = [...rows]
  const result: Material[] = []
  let previousTopic = ''
  for (let position = 0; position < count && ranked.length; position++) {
    const slot = (offset + position) % 15
    const desired: Kind | undefined = slot === 3 || slot === 12 ? 'film' : slot === 5 || slot === 10 ? 'track' : undefined
    let match = desired ? ranked.findIndex((candidate) => candidate.kind === desired) : -1
    if (match < 0) match = ranked.findIndex((candidate, index) => index < 10 &&
      candidate.kind === 'image' && candidate.topic !== previousTopic)
    const [entry] = ranked.splice(Math.max(match, 0), 1)
    result.push(entry)
    previousTopic = entry.topic
  }
  return result
}

export function recommendBatch(candidates: Material[], library: Library, size: number, offset: number,
  eclectic: boolean, seed: number): Material[] {
  const confidence = library.personalize ? Math.min(1, library.model.updates / 10) : 0
  const scores = candidates.map((item) => {
    const shuffled = hash(item.id + ':' + seed)
    const featured = typeof item.featured === 'number' ? Math.max(0, 1.12 - item.featured * .018) : 0
    const prediction = confidence > 0 ? logit(library.model, features(item)) : 0
    // Discovery keeps a small exploration term and favors reviewed covers at cold start.
    const score = prediction * 1.25 + shuffled * (.75 - .36 * confidence) + featured * (1.35 - 1.15 * confidence)
    return { item, score }
  }).sort((a, b) => b.score - a.score).map((entry) => entry.item)
  if (!eclectic) return scores.slice(0, size)
  return diversify(scores, size, offset)
}

export function similarTo(current: Material, items: Material[], hidden: string[]) {
  const selected = new Map(features(current))
  const blocked = new Set(hidden)
  return items.filter((item) => item.id !== current.id && !blocked.has(item.id)).map((item) => {
    const candidate = features(item)
    const likeness = candidate.reduce((score, [name, amount]) => score + (selected.get(name) ?? 0) * amount, 0)
    const score = likeness / Math.sqrt(candidate.reduce((total, [, amount]) => total + amount ** 2, 0))
    return { item, score }
  }).sort((a, b) => b.score - a.score || hash(a.item.id) - hash(b.item.id)).map((row) => row.item)
}
