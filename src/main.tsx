import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
// the dashboard (Sui SDK, QR, wallet standard) loads only when needed; the landing page stays light
const App = lazy(() => import('./App.tsx'))
import Landing from './Landing.tsx'
import './index.css'
import { registerWebMcp } from './webmcp'

// Owner passcode (APP_PASSCODE on the server): sent on writes, asked for once on a 401.
const rawFetch = window.fetch.bind(window)
// Built for Walrus Sites (static, served from wal.app), the API lives on the Vercel deployment.
const API_BASE = import.meta.env.VITE_API_BASE || ''
window.fetch = async (input, init = {}) => {
  if (API_BASE && typeof input === 'string' && input.startsWith('/api/')) input = API_BASE + input
  const isWrite = (init.method || 'GET').toUpperCase() !== 'GET'
  const withPass = () => ({ ...init, headers: { ...(init.headers as Record<string, string>), 'x-passcode': localStorage.getItem('ic-passcode') || '' } })
  let res = await rawFetch(input, isWrite ? withPass() : init)
  if (isWrite && res.status === 401) {
    const pass = window.prompt('Owner passcode')
    if (pass) {
      localStorage.setItem('ic-passcode', pass)
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
    {landing ? <Landing /> : <Suspense fallback={null}><App /></Suspense>}
  </StrictMode>,
)
