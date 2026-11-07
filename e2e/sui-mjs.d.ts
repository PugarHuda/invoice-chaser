// types for the server module imported by the payer-proof spec
declare module '../server/sui.mjs' {
  export function payerProofMessage(invoiceId: string, clientName: string, issuedAt: string): string
  export function verifyPayerProof(p: { message: string; signature: string; address: string; invoiceId: string; clientName: string; now?: number }): Promise<{ ok: true; address: string; scheme: string } | { ok: false; reason: string }>
}
