import type { Theme } from '../api/types'

export const mediaLabels = { track: 'Трек', film: 'Фильм', image: 'Изображение' }
export const visibilityLabels = { public: 'Публичная', link: 'По ссылке', private: 'Приватная' }
export const themeLabels: Record<Theme, string> = {
  amber: 'Янтарь', blue: 'Кобальт', violet: 'Ирис', moss: 'Шалфей', rose: 'Киноварь', slate: 'Графит',
}

export function tagsFrom(value: string) {
  return [...new Set(value.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean))]
}

export function dateLabel(value: string) {
  return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}
