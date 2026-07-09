
import { useEffect, useState } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import TripPlanner from './pages/TripPlanner'
import Auth from './pages/Auth'
import Profile from './pages/Profile'
import Discover from './pages/Discover'
import ProtectedRoute from "./components/ProtectedRoute"
import TripSettings from "./pages/TripSettings"
import { tryRefresh } from "./api/client"

function App() {
  // bootstrap-сессия (S8 WP-1): один refresh по httpOnly cookie на старте,
  // чтобы перезагрузка страницы не разлогинивала
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => {
    tryRefresh().finally(() => setBootstrapped(true))
  }, [])

  if (!bootstrapped) {
    return (
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280'}}>
        Загрузка...
      </div>
    )
  }

  return(
    <BrowserRouter>
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/trips/:tripId" element={<ProtectedRoute><TripPlanner /></ProtectedRoute>} />
      <Route path="/discover" element={<ProtectedRoute><Discover /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/discover" replace />} />
      <Route path="/trips/:tripId/settings" element={<ProtectedRoute><TripSettings /></ProtectedRoute>} />
    </Routes>
    </BrowserRouter>
  )
}

export default App
