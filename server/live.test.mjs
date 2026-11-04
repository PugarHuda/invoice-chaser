import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matches } from './live.mjs'

test('live stream matches only the exact amount to the exact payee in the settlement coin', () => {
  const C = '0xusdc::usdc::USDC'
  const w = { payee: '0xabc', micro: 300004217n, hit: false }
  const cp = { transactions: [
    { digest: 'wrongCoin', balanceChanges: [{ address: '0xabc', coinType: '0x2::sui::SUI', amount: '300004217' }] },
    { digest: 'wrongAmt', balanceChanges: [{ address: '0xabc', coinType: C, amount: '300000000' }] },
    { digest: 'otherPayee', balanceChanges: [{ address: '0xdef', coinType: C, amount: '300004217' }] },
    { digest: 'good', balanceChanges: [{ address: '0x0abc', coinType: C, amount: '300004217' }, { address: '0x1', coinType: C, amount: '-300004217' }] },
    { digest: 'second', balanceChanges: [{ address: '0xabc', coinType: C, amount: '300004217' }] },
  ] }
  assert.deepEqual(matches(cp, [w], C).map(([, d]) => d), ['good'])
  assert.deepEqual(matches(cp, [{ ...w, hit: true }], C), [])
})
