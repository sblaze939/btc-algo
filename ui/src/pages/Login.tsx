import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function Login() {
  const navigate = useNavigate()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      await api.login(pw)
      navigate('/dashboard')
    } catch {
      setErr('Wrong password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-[#A07820] flex items-center justify-center font-bold text-xl text-bg shadow-[0_8px_24px_rgba(212,168,67,0.3)] mb-4">
            KA
          </div>
          <h1 className="text-xl font-bold tracking-tight">KiraFX Algos</h1>
          <p className="text-muted text-sm mt-1">BTC Options Management</p>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="bg-s1 border border-border rounded-[14px] p-6">
          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
            Password
          </label>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="Enter access password"
            autoFocus
            className="w-full bg-bg border border-border text-tx placeholder-muted2 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-accent transition-colors mb-4"
          />
          {err && <p className="text-red text-sm mb-3">{err}</p>}
          <button
            type="submit"
            disabled={loading || !pw}
            className="w-full bg-accent text-bg font-bold rounded-lg py-2.5 text-sm transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            {loading ? 'Verifying…' : 'Access Dashboard'}
          </button>
        </form>

        <p className="text-center text-muted2 text-xs mt-4">
          Oracle Cloud · trading-bots · 129.225.65.244
        </p>
      </div>
    </div>
  )
}
