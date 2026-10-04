
import { useEffect, useState } from "react"
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import TripPlanner from './pages/TripPlanner'
import Auth from './pages/Auth'
import Profile from './pages/Profile'
import Discover from './pages/Discover'
import ProtectedRoute from "./components/ProtectedRoute"
import TripSettings from "./pages/TripSettings"
import { tryRefresh } from "./api/client"
import ErrorBoundary from "./components/ErrorBoundary"

// ошибка рендера сбрасывается при переходе на другой путь
function RoutedBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
}

function App() {
  // bootstrap-сессия (S8 WP-1): один refresh по httpOnly cookie на старте,
  // чтобы перезагрузка страницы не разлогинивала
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => {
    tryRefresh().finally(() => setBootstrapped(true))
  }, [])

  if (!bootstrapped) {
    // без t(): i18n мог ещё не догрузиться, а строка чисто техническая
    return (
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)'}}>
        ...
      </div>
    )
  }

  return(
    <BrowserRouter>
    <RoutedBoundary>
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/trips/:tripId" element={<ProtectedRoute><TripPlanner /></ProtectedRoute>} />
      {/* S13: превью чужой поездки — тот же планировщик в режиме чтения */}
      <Route path="/trips/:tripId/preview" element={<ProtectedRoute><TripPlanner readOnly /></ProtectedRoute>} />
      <Route path="/discover" element={<ProtectedRoute><Discover /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/discover" replace />} />
      <Route path="/trips/:tripId/settings" element={<ProtectedRoute><TripSettings /></ProtectedRoute>} />
    </Routes>
    </RoutedBoundary>
    </BrowserRouter>
  )
}

export default App
