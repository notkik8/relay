import { Link } from 'react-router-dom'
import { Empty } from '../components/UI'

export function NotFoundPage() {
  return <Empty title="Страница не найдена"><Link className="button primary" to="/">К подборкам</Link></Empty>
}
