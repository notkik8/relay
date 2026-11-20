import { ArrowDown, ArrowRight, Plus } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'
import { useFeed, useSession } from '../api/queries'
import { Artwork, BoardGrid, Counts, Empty, Feedback, Loading } from '../components/UI'

type Mode = 'public' | 'following' | 'mine'

export function FeedPage({ mode = 'public' }: { mode?: Mode }) {
  const session = useSession()
  const feed = useFeed(mode, mode === 'public' || Boolean(session.data))
  if (mode !== 'public' && session.isPending) return <Loading />
  if (mode !== 'public' && !session.data) return <Navigate to={`/login?next=%2F${mode}`} replace />
  const boards = feed.data?.pages.flatMap((page) => page.items) ?? []
  const featured = mode === 'public' ? boards[0] : undefined
  const title = { public: 'Подборки', following: 'Подписки', mine: 'Мои подборки' }[mode]

  return <div className="feed-page">
    {featured && <section className={`featured featured-${featured.theme}`} aria-labelledby="featured-title">
      <div className="featured-content">
        <div className="feature-label"><span /> Из подборок сообщества</div>
        <h1 id="featured-title">{featured.title}</h1>
        <p>{featured.description || `Подборка пользователя ${featured.author.name}`}</p>
        <div className="featured-actions">
          <Link className="button primary" to={`/b/${featured.key}`}>Смотреть подборку <ArrowRight size={18} /></Link>
          <Counts counts={featured.counts} />
        </div>
      </div>
      <Link className="featured-visual" to={`/b/${featured.key}`} aria-label={featured.title}>
        <Artwork theme={featured.theme} url={featured.cover_url} eager />
      </Link>
    </section>}
    <section aria-labelledby="feed-title">
      <div className="section-heading">
        <div>
          {featured ? <h2 id="feed-title">{title}</h2> : <h1 id="feed-title">{title}</h1>}
          {mode === 'public' && <p>Музыка, кино и изображения, собранные в одном месте.</p>}
          {mode === 'following' && <p>Свежие публикации авторов, на которых вы подписаны.</p>}
        </div>
        {mode === 'mine' && <Link className="button primary" to="/new"><Plus size={18} /> Новая подборка</Link>}
      </div>
      {feed.isPending && <Loading label="Загружаем подборки…" />}
      <Feedback error={feed.error} />
      {feed.isError && !boards.length && <button className="button" onClick={() => void feed.refetch()}>Повторить</button>}
      {feed.isSuccess && (boards.length ? <BoardGrid boards={featured && boards.length > 1 ? boards.slice(1) : boards} />
        : <Empty title={mode === 'mine' ? 'У вас пока нет подборок' : mode === 'following'
          ? 'Здесь появятся подборки ваших авторов' : 'Пока нет публичных подборок'}>
          <Link className="button" to={mode === 'following' ? '/' : session.data ? '/new' : '/login?next=%2Fnew'}>
            {mode === 'following' ? 'Посмотреть рекомендации' : 'Создать подборку'} <ArrowRight size={16} />
          </Link>
        </Empty>)}
      {feed.hasNextPage && <div className="more"><button className="button" disabled={feed.isFetchingNextPage}
        onClick={() => void feed.fetchNextPage()}><ArrowDown size={16} /> Ещё подборки</button></div>}
    </section>
  </div>
}
