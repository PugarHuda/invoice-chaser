// Node's fetch() ignores HTTP_PROXY/HTTPS_PROXY, and workspace pods have no other way
// out. No-op when the vars are unset (local dev, Vercel).
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

setGlobalDispatcher(new EnvHttpProxyAgent())
