import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Owner passcode (APP_PASSCODE on the server): sent on writes, asked for once on a 401.
const rawFetch = window.fetch.bind(window)
window.fetch = async (input, init = {}) => {
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
