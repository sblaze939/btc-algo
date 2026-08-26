import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import Journal from './pages/Journal'
import Settings from './pages/Settings'
import Logs from './pages/Logs'
import Trading from './pages/Trading'
import Performance from './pages/Performance'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard"   element={<Dashboard />} />
        <Route path="/accounts"    element={<Accounts />} />
        <Route path="/trading"     element={<Trading />} />
        <Route path="/journal"     element={<Journal />} />
        <Route path="/performance" element={<Performance />} />
        <Route path="/settings"    element={<Settings />} />
        <Route path="/logs"        element={<Logs />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
