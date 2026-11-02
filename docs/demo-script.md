# Demo video script (target 2:30, max 3:00)

Record at 1920×1080, browser zoom 110%. Have ready: the deployed app, a second Sui wallet with ~0.1 USDC + gas, Walruscan tab, Suiscan tab.

| Time | Screen | Say (voice-over) |
|---|---|---|
| 0:00 | Today page | "Freelancers paid in USDC chase the same late clients every month, and their tools forget every time. Invoice Chaser remembers, using Walrus Memory." |
| 0:15 | Clients → Acme | "Acme always pays about five days late. Here's what the app learned from Acme's history, all stored in Walrus Memory: median delay five days, formal reminders work, friendly ones don't." |
| 0:30 | Learning chart | "Before each payment it predicted the delay. Off by four days, then two, then exact, exact. It learned." |
| 0:45 | Invoices → inv-101, toggle Ignore memory | "Same invoice. Without memory: friendly nudge the day after due. With memory: one formal reminder on the 9th, payment expected on the 10th. The Why panel shows the memories behind it." |
| 1:05 | Client page: type "Never chase Acme before the 10th" → Save | "I can teach it rules. This becomes a memory too…" |
| 1:15 | Invoice plan updates to the 10th | "…and the plan obeys it." |
| 1:25 | Invoices → New invoice: Delta, 0.05 USDC | "A new invoice gets a unique amount; the decimals identify it on-chain." |
| 1:35 | Wallet: send exact amount, copy digest → Pay page → Verify | "The client pays from any Sui wallet. I paste the digest; the server checks it on Sui Mainnet through Tatum's gRPC gateway…" |
| 1:55 | Paid ✓, Delta timeline shows new memory → "On Walrus" link | "…paid, and it's written to Walrus. Delta now has a history, so next time it won't get the default treatment." |
| 2:10 | Clients → Total Recall button | "There's no database. Walrus Memory is the record. Wipe local state, rebuild everything from Walrus." |
| 2:20 | /proof | "Live proof: Sui checkpoint from Tatum, memory counts from the Walrus relayer." |
| 2:28 | Today | "Every invoice makes the next one easier. Invoice Chaser." |

Notes
- Say once that the Aug–Oct history is seeded and labelled; everything you do on camera is live.
- Keep the wallet seed phrase and private keys off screen.
