import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { Account, Board, Page } from './types'

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => api<Account | null>('/accounts/me', { signal }),
    retry: false,
  })
}

export function useFeed(mode: 'public' | 'following' | 'mine', enabled = true) {
  return useInfiniteQuery({
    queryKey: ['feed', mode],
    queryFn: ({ signal, pageParam }) =>
      api<Page<Board>>(`/feed?mode=${mode}&offset=${pageParam}`, { signal }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled,
  })
}

export function usePage<T, Result extends Page<T> = Page<T>>(name: string, url: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: [name, url],
    queryFn: ({ signal, pageParam }) => api<Result>(
      `${url}${url.includes('?') ? '&' : '?'}offset=${pageParam}`, { signal },
    ),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled,
  })
}
