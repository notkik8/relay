import { useCallback, useEffect, useRef, useState } from 'react'
import type { Material } from './catalog'
import { readLibrary, resetModel, train, writeLibrary, type Library, type Signal } from './recommend'

type Undo = { type: 'hide'; material: Material; learn: boolean; evicted?: string }
  | { type: 'unsave'; id: string; index: number }

const hiddenLimit = 600

export function useDiscoveryLibrary() {
  const [library, setLibrary] = useState(readLibrary)
  const live = useRef(library)
  const observations = useRef(new Set<string>())
  const storeTimer = useRef<number | undefined>(undefined)
  const pending = useRef<Undo | undefined>(undefined)
  const [notice, setNotice] = useState<{ text: string; undo: boolean } | null>(null)

  const commit = useCallback((updated: Library) => {
    live.current = updated
    writeLibrary(updated)
    setLibrary(updated)
  }, [])

  const signal = useCallback((item: Material, type: Signal) => {
    const entry = `${item.id}:${type}`
    if (!live.current.personalize || observations.current.has(entry)) return
    observations.current.add(entry)
    live.current = { ...live.current, model: train(live.current.model, item, type) }
    if (type === 'open' || type === 'save' || type === 'play' || type === 'less') {
      writeLibrary(live.current)
      return
    }
    if (storeTimer.current === undefined) {
      storeTimer.current = window.setTimeout(() => {
        writeLibrary(live.current)
        storeTimer.current = undefined
      }, 400)
    }
  }, [])

  const finish = useCallback(() => {
    const action = pending.current
    pending.current = undefined
    if (action?.type === 'hide' && action.learn && live.current.hidden.includes(action.material.id)) {
      signal(action.material, 'less')
    }
  }, [signal])

  useEffect(() => {
    const flush = () => {
      finish()
      writeLibrary(live.current)
      setNotice(null)
    }
    const update = (event: StorageEvent) => {
      if (event.key !== 'relay.discovery.v1') return
      const next = readLibrary()
      live.current = next
      setLibrary(next)
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('storage', update)
      window.clearTimeout(storeTimer.current)
      storeTimer.current = undefined
    }
  }, [finish])

  const notify = useCallback((text: string) => {
    finish()
    setNotice({ text, undo: false })
  }, [finish])

  const dismiss = useCallback(() => {
    finish()
    setNotice(null)
  }, [finish])

  const undo = useCallback(() => {
    const action = pending.current
    pending.current = undefined
    if (!action) return
    const current = live.current
    if (action.type === 'hide') {
      const hidden = current.hidden.filter((id) => id !== action.material.id)
      if (action.evicted && hidden.length < hiddenLimit && !hidden.includes(action.evicted)) hidden.push(action.evicted)
      commit({ ...current, hidden })
      setNotice({ text: 'Материал возвращён в ленту', undo: false })
    } else {
      if (!current.saved.includes(action.id)) {
        const saved = [...current.saved]
        saved.splice(action.index, 0, action.id)
        commit({ ...current, saved })
      }
      setNotice({ text: 'Материал снова в сохранённом', undo: false })
    }
  }, [commit])

  const save = useCallback((material: Material) => {
    finish()
    const index = live.current.saved.indexOf(material.id)
    if (index >= 0) {
      commit({ ...live.current, saved: live.current.saved.filter((id) => id !== material.id) })
      pending.current = { type: 'unsave', id: material.id, index }
      setNotice({ text: 'Убрано из сохранённого', undo: true })
    } else {
      signal(material, 'save')
      commit({ ...live.current, saved: [material.id, ...live.current.saved] })
      setNotice({ text: 'Материал сохранён', undo: false })
    }
  }, [commit, finish, signal])

  const hide = (material: Material) => {
    finish()
    const current = live.current
    const hidden = [material.id, ...current.hidden.filter((id) => id !== material.id)]
    // Hiding is immediate. Apply training only once the undo window closes.
    commit({ ...current, hidden: hidden.slice(0, hiddenLimit) })
    pending.current = { type: 'hide', material, learn: current.personalize, evicted: hidden[hiddenLimit] }
    setNotice({ text: 'Будем показывать меньше похожего', undo: true })
  }

  const toggle = () => {
    finish()
    commit({ ...live.current, personalize: !live.current.personalize })
    setNotice(null)
  }

  const reset = () => {
    pending.current = undefined
    commit(resetModel(live.current))
    observations.current.clear()
    setNotice({ text: 'Предпочтения сброшены', undo: false })
  }

  return { library, live, signal, save, hide, notify, notice, dismiss, undo, toggle, reset }
}
