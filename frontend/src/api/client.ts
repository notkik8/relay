const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (typeof init?.body === 'string') headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'same-origin' })
  } catch (error) {
    if (init?.signal?.aborted) throw error
    throw new ApiError(0, 'Не удалось связаться с Relay. Повторите попытку.')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    const messages = Array.isArray(data?.detail) ? data.detail.map((item: { loc: string[] }) =>
      ({ email: 'Проверьте адрес почты', password: 'Проверьте длину пароля',
        username: 'Имя пользователя должно содержать 3–32 латинских символа, цифры или подчёркивания',
        tags: 'Укажите до 12 тегов, каждый длиной до 40 символов' })[String(item.loc?.[item.loc.length - 1])]
        ?? 'Проверьте введённые данные') : []
    const message = typeof data?.detail === 'string' ? data.detail
      : messages[0] ?? (response.status === 413 ? 'Изображение должно весить не более 10 МБ'
        : 'Запрос не выполнен. Повторите попытку.')
    throw new ApiError(response.status, message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function send<T = void>(path: string, method: string, data?: object) {
  return api<T>(path, { method, body: data === undefined ? undefined : JSON.stringify(data) })
}

export function upload<T = void>(path: string, method: string, file: File, title?: string) {
  if (file.size > 10 * 1024 * 1024) throw new ApiError(413, 'Изображение должно весить не более 10 МБ')
  const body = new FormData()
  body.append('file', file)
  if (title) body.append('title', title)
  return api<T>(path, { method, body })
}
