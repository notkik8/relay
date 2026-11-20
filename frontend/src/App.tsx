import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Loading } from './components/UI'
import { AuthPage } from './pages/AuthPage'
import { BoardRoute, NewBoardPage } from './pages/BoardPage'
import { NotificationsPage, ProfilePage, SearchPage } from './pages/Community'
import { FeedPage } from './pages/FeedPage'
import { NotFoundPage } from './pages/NotFoundPage'
import DiscoveryPage from './discovery/DiscoveryPage'

const AdminPage = lazy(() => import('./pages/AdminPage'))

export default function App() {
  return <Routes>
    <Route element={<DiscoveryPage />}>
      <Route index />
      <Route path="saved" />
      <Route path="pin/:materialId" />
    </Route>
    <Route element={<Layout />}>
      <Route path="collections" element={<FeedPage />} />
      <Route path="following" element={<FeedPage mode="following" />} />
      <Route path="mine" element={<FeedPage mode="mine" />} />
      <Route path="login" element={<AuthPage key="login" />} />
      <Route path="register" element={<AuthPage key="register" register />} />
      <Route path="search" element={<SearchPage />} />
      <Route path="new" element={<NewBoardPage />} />
      <Route path="b/:key" element={<BoardRoute />} />
      <Route path="b/:key/edit" element={<BoardRoute editing />} />
      <Route path="u/:username" element={<ProfilePage />} />
      <Route path="notifications" element={<NotificationsPage />} />
      <Route path="admin" element={<Suspense fallback={<Loading />}><AdminPage /></Suspense>} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes>
}
