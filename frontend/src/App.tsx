
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import TripPlanner from './pages/TripPlanner'
import Auth from './pages/Auth'
import Profile from './pages/Profile'
import Discover from './pages/Discover'
import ProtectedRoute from "./components/ProtectedRoute"

function App() {
  return(
    <BrowserRouter>
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/trips/:tripId" element={<ProtectedRoute><TripPlanner /></ProtectedRoute>} />
      <Route path="/discover" element={<ProtectedRoute><Discover /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/discover" replace />} />
    </Routes>
    </BrowserRouter>
  )
}

export default App