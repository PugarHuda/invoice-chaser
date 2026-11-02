// Cold-start seed lands here via an init container; a future push mechanism
// (workspace-bridge -> creds.json) rewrites it in place. Re-applied onto
// process.env so existing consumers (process.env.TATUM_API_KEY) keep working
// without a container restart. Directory-watched, not file-watched — an
// atomic rewrite (write-temp + rename) swaps the inode a direct file watch
// would lose.
import { readFileSync, watch } from 'node:fs'
import { dirname, basename } from 'node:path'

const CREDS_PATH = process.env.CREDS_PATH ?? '/creds/creds.json'
const CREDS_DIR = dirname(CREDS_PATH)
const CREDS_FILE = basename(CREDS_PATH)

let current = {}

function apply() {
  let blob
  try {
    blob = JSON.parse(readFileSync(CREDS_PATH, 'utf-8'))
  } catch {
    return // no readable blob yet, or a transient partial write — keep the last good value
  }
  // JSON.parse succeeds on any valid JSON value, not just objects (null, a
  // number, an array) — guard against a malformed-but-syntactically-valid
  // file crashing the Object.entries below and keep the last good value.
  if (blob === null || typeof blob !== 'object' || Array.isArray(blob)) return
  current = blob
  for (const [key, value] of Object.entries(blob)) {
    if (typeof value === 'string') process.env[key.toUpperCase()] = value
  }
}

apply()

try {
  watch(CREDS_DIR, { persistent: false }, (_event, filename) => {
    if (filename === CREDS_FILE) apply()
  })
} catch {
  // creds volume not mounted (e.g. local dev outside the pod) — nothing to watch
}

export function credentialValues() {
  return Object.values(current).filter((v) => typeof v === 'string')
}
