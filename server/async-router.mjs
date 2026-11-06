// Express 4 does not catch a rejected promise from an async handler: the request hangs and the
// rejection is unhandled. This Router forwards every handler's rejection (and sync throw) to next(),
// so the API's JSON error handler in app.mjs answers instead. Express 5 does this natively.
import express from 'express'

const wrap = (h) => (typeof h !== 'function' || h.length === 4 ? h : (req, res, next) => {
  try {
    const r = h(req, res, next)
    if (r && typeof r.catch === 'function') r.catch(next)
  } catch (e) {
    next(e)
  }
})

export function Router() {
  // case-sensitive + strict: '/X402/..' or '/proof/' can't reach a handler while slipping past the rate limiter's path checks
  const r = express.Router({ caseSensitive: true, strict: true })
  for (const m of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
    const orig = r[m].bind(r)
    r[m] = (...args) => orig(...args.map((a) => (Array.isArray(a) ? a.map(wrap) : wrap(a))))
  }
  return r
}
