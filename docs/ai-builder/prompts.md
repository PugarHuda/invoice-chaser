# Tatum AI Builder prompts (verbatim log)

## P1 — sent 2026-11-02 (free prompt, 7m30s build). Output = commit 1136f7a, tag ai-builder-v0

Build "Invoice Chaser": an invoice tracker for freelancers who get paid in USDC on Sui Mainnet. It learns how each client pays and adapts reminders per client using Walrus Memory.

Stack: Next.js (App Router, TypeScript), Postgres, deploy to Vercel. All secrets server-side only.

Screens:
1. Today: expected USDC inflow next 7 days, overdue invoices, "next actions" list (e.g. "Remind Acme on Thu, formal tone").
2. Clients: list with predicted payment delay and a reliability badge. Client detail: profile card (median delay in days, reminders usually needed, best reminder tone with hit-rate, underpay rate), a timeline of memories, and a text box "Tell me something about this client" whose input is saved as a preference.
3. Invoice detail: status (draft/sent/overdue/partial/paid), pay link + QR, reminder plan with a "Why?" panel listing the memories used, and an "Ignore memory" toggle that shows the default plan for comparison.
4. Public pay page /pay/[invoiceId]: amount, recipient address, connect a Sui wallet (@mysten/dapp-kit) and pay in USDC, or paste a transaction digest.
5. /proof: live check of the Tatum Sui gRPC gateway (latest checkpoint, payee USDC balance) and Walrus Memory (relayer health, memory count per namespace, sample memories).

Payments via Tatum Sui gRPC (sui-mainnet-grpc.gateway.tatum.io:443, TLS, metadata header x-api-key = TATUM_API_KEY; do NOT use JSON-RPC):
- Each invoice gets a unique payable amount (base amount + a random 4-6 digit micro-USDC suffix, 6 decimals). USDC coin type: 0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC.
- Verify a payment with LedgerService.GetTransaction(digest): status success and balance_changes contain +pay_amount USDC to SUI_PAYEE_ADDRESS. A digest can settle only one invoice. Less than expected = partial.
- A cron route every minute calls StateService.GetBalance for the payee; a balance increase matching an open invoice's pay_amount flags it "payment likely received".

Memory via Walrus Memory SDK @mysten-incubation/memwal (server-side; MemWal.create({ key: MEMWAL_PRIVATE_KEY, accountId: MEMWAL_ACCOUNT_ID, serverUrl: "https://relayer.memory.walrus.xyz", namespace })), one namespace per client "ic:main:client:<id>":
- On invoice sent, reminder sent, invoice paid/partial, preference given: remember() a one-line human-readable sentence followed by "#ic " + a JSON tag (type, client, invoice, due, paid, delay_days, reminders, last_tone, amounts, digest), then waitForRememberJob.
- Before planning reminders: recall({ query: "payment behaviour and preferences of <client>", limit: 20 }), parse the #ic tags, compute the profile deterministically: EWMA delay (alpha 0.5), predicted pay date = due + delay, reminders needed, tone hit-rate per tone (friendly/formal/firm; hit = paid within 3 days of that reminder), underpay rate. Preferences (e.g. "never chase before the 10th") are hard constraints.
- No history: remind at due+1 friendly, due+5 formal, due+10 firm. With history: schedule around the predicted pay date and use the best tone. Save each decision as a memory citing the memories used.
- If the memory relayer fails, queue writes in a pending_memories table and retry; never show unsaved memories as saved.
- Cache profiles in Postgres but they must be rebuildable from Walrus Memory alone (a "Rebuild from memory" button).

Tables: clients, invoices (pay_amount unique, digest unique), reminders, profiles (cache), pending_memories.
Seed 4 demo clients: Acme (pays ~5 days late, needs 2 reminders, formal works), Beta (on time), Gamma (underpays ~10%), Delta (new).
Design: clean finance tool, light and dark, no crypto jargon on product screens; hashes only on /proof and in "Why?" links (Suiscan / Walruscan).
