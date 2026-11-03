// Local signer for the Playwright QA test wallet. Testnet only, binds to 127.0.0.1.
//   SUI_NETWORK=testnet node --env-file=.env.local --env-file=.env.testagent scripts/test-wallet-server.mjs
import http from 'node:http'
import { address, signAndExecute } from './test-wallet-signer.mjs'

const key = process.env.AP_AGENT_KEY
http
  .createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    try {
      if (req.method === 'GET') return res.end(JSON.stringify({ address: address(key) }))
      let body = ''
      for await (const c of req) body += c
      res.end(JSON.stringify(await signAndExecute(JSON.parse(body).json, key)))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: e.message }))
    }
  })
  .listen(3099, '127.0.0.1', () => console.log('test wallet signer on 127.0.0.1:3099'))
