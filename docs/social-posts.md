# Social posts (drafts; post after the demo URL and video are live)

## X (thread)

1/ Every freelancer has an "Acme": pays 5 days late, ignores friendly nudges, pays right after a formal one. Every month. Your invoicing tool forgets every time.

I built Invoice Chaser for #TotalRecall: invoices in USDC on Sui that learn how each client pays. 🧵

2/ Same invoice, memory off vs on:
off → friendly nudge on day +1
on → one formal reminder on day +4, payment predicted day +5

The "Why?" panel lists the @WalrusProtocol memories behind the decision.

3/ It learns: before each of Acme's payments it predicted the delay. Off by 4 days → 2 → 0 → 0.

4/ Walrus Memory is the only database. Restart the server and everything (clients, invoices, learned profiles) is rebuilt from Walrus. There's a button for it: Total Recall.

5/ Payments are verified on Sui Mainnet through @Tatum_io's gRPC gateway: each invoice has a unique micro-amount, the digest is checked against balance_changes.

Started from one prompt in Tatum AI Builder, then wired to the real stack.

Demo: TODO · Code: github.com/PugarHuda/invoice-chaser

## LinkedIn

Freelancers paid in stablecoins chase the same late clients every month, and their tools forget every time.

For the Total Recall hackathon (Tatum × Walrus Foundation) I built Invoice Chaser: an invoice tracker for USDC on Sui that remembers how each client pays and adapts the reminder plan to them: when to chase, in what tone, and when the money is likely to arrive.

• Walrus Memory is the system of record: every invoice, reminder and payment is a memory, and the app rebuilds its whole state from Walrus on start.
• Payments are verified on Sui Mainnet through Tatum's gRPC gateway.
• It measurably learns: the delay prediction for one client went from 4 days off to exact in four invoices.

Demo: TODO
Code: https://github.com/PugarHuda/invoice-chaser

#Walrus #Sui #Tatum #TotalRecall
