import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
// the dashboard (Sui SDK, QR, wallet standard) loads only when needed; the landing page stays light
const App = lazy(() => import('./App.tsx'))
import Landing from './Landing.tsx'
import './index.css'
import { registerWebMcp } from './webmcp'

// Owner passcode (APP_PASSCODE on the server): sent on writes (and on reads once stored, for PRIVATE_READS), asked for once on a 401.
const rawFetch = window.fetch.bind(window)
// Built for Walrus Sites (static, served from wal.app), the API lives on the Vercel deployment.
const API_BASE = import.meta.env.VITE_API_BASE || ''
let promptOpen = false
window.fetch = async (input, init = {}) => {
  const isApi = typeof input === 'string' && input.startsWith('/api/')
  if (API_BASE && isApi) input = API_BASE + input
  const isWrite = (init.method || 'GET').toUpperCase() !== 'GET'
  const withPass = () => ({ ...init, headers: { ...(init.headers as Record<string, string>), 'x-passcode': localStorage.getItem('ic-passcode') || '' } })
  // a stored passcode also goes with reads: with PRIVATE_READS on, the owner's data needs it too
  const hasPass = Boolean(localStorage.getItem('ic-passcode'))
  let res = await rawFetch(input, isApi && (isWrite || hasPass) ? withPass() : init)
  // ask once, for a write or (private mode) an owner read; a payer's pay page never hits this
  if (isApi && res.status === 401 && !promptOpen) {
    promptOpen = true
    const pass = window.prompt('Owner passcode')
    promptOpen = false
    if (pass) {
      localStorage.setItem('ic-passcode', pass)
      // the dashboard loads several reads at once: reload so every one of them retries with the passcode
      if (!isWrite) { window.location.reload(); return res }
      res = await rawFetch(input, withPass())
    }
  }
  return res
}

// WebMCP: in-browser agents get the page's read tools (no-op where unsupported)
registerWebMcp(new URLSearchParams(window.location.search).get('pay'))

// "/" is the landing page; the dashboard is /?app (or /?tab=<tab>), a pay link /?pay=<id>
const q = new URLSearchParams(window.location.search)
const landing = !q.has('pay') && !q.has('app') && !q.has('tab')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {landing ? <Landing /> : <Suspense fallback={<p role="status" style={{ padding: '3rem 1rem', textAlign: 'center', font: '14px system-ui, sans-serif', color: '#555' }}>{q.has('pay') ? 'Loading invoice…' : 'Loading dashboard…'}</p>}><App /></Suspense>}
  </StrictMode>,
)
