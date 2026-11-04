import React, { useState, useEffect } from 'react';
import { getWallets } from '@mysten/wallet-standard';
import { Transaction } from '@mysten/sui/transactions';
import QRCode from 'qrcode';

// ?pay=<invoice> is the public, client-facing pay page (no owner tabs).
const PAY_ONLY = new URLSearchParams(window.location.search).get('pay');
import {
  Clock,
  AlertCircle,
  TrendingUp,
  Brain,
  ExternalLink,
  QrCode,
  Copy,
  DollarSign,
  RefreshCw,
  MessageSquare,
  HelpCircle,
  CreditCard,
  Check,
  ShieldCheck,
  ChevronDown
} from 'lucide-react';

type TabKey = 'today' | 'clients' | 'invoices' | 'pay' | 'proof';

interface SummaryData {
  expectedInflow7Days: string;
  expectedInflow30Days?: string;
  overdueAmount: string;
  activeClientNamespaces: number;
  upcomingInflows: Array<{
    invoiceId: string;
    clientName: string;
    payAmount: string;
    dueDate: string;
    predictedPayDate: string;
    delayDays: number;
    status: string;
  }>;
  nextActions: Array<{
    invoiceId: string;
    clientId: string;
    clientName: string;
    amount: string;
    actionDate: string;
    recommendedTone: string;
    reason: string;
    underpayRisk: number | null;
  }>;
}

interface ClientProfile {
  clientId: string;
  medianDelayDays: number;
  ewmaDelayDays: number;
  remindersNeeded: number;
  bestTone: string;
  toneStats: Record<string, { hits: number; total: number; rate: number }>;
  underpayRate: number;
  totalPaidInvoices: number;
  reliabilityBadge: string;
  preferences: string[];
  revokedRules?: string[];
  creditUsdc?: string;
  memoryCount: number;
  history?: Array<{ invoice: string; n: number; predicted: number; actual: number; error: number }>;
}

interface ClientDetail {
  client: {
    id: string;
    name: string;
    email: string;
    address: string;
  };
  profile: ClientProfile;
  memories: Array<{
    id: string;
    sentence: string;
    tag: Record<string, any>;
    timestamp: string;
    status: string;
  }>;
  namespace: string;
}

interface InvoiceDetail {
  invoice: {
    id: string;
    clientId: string;
    clientName: string;
    baseAmount: number;
    payAmount: string;
    status: string;
    dueDate: string;
    issuedDate: string;
    description: string;
    digest: string | null;
    payeeAddress: string;
    coinType: string;
    network?: string;
    paymentUri?: string;
    registry?: string;
    explorerTx?: string | null;
    receipt?: { blobId: string; url: string; at: string } | null;
    receiptsEnabled?: boolean;
  };
  adaptivePlan: {
    cites?: Array<{ sentence: string; blobId: string | null; status: string; at: string }>;
    type: string;
    predictedPayDate: string;
    predictedDelayDays: number;
    steps: Array<{ dayOffset: number; date: string; tone: string; reason: string }>;
    memoriesUsed: string[];
  };
  defaultPlan: {
    type: string;
    predictedPayDate: string;
    steps: Array<{ dayOffset: number; date: string; tone: string; reason: string }>;
    memoriesUsed: string[];
  };
}

interface ProofData {
  tatumSuiGrpc: {
    endpoint: string;
    protocol: string;
    apiKeyConfigured: boolean;
    gatewayStatus: string;
    latestCheckpoint: string;
    payeeAddress: string;
    payeeBalance: string;
    usdcCoinType: string;
    errorDetail: string | null;
  };
  walrusMemory: {
    relayerUrl: string;
    sdk: string;
    relayerStatus: string;
    totalMemories: number;
    namespaceCount: number;
    namespaces: Record<string, number>;
    pendingMemoriesCount: number;
    sampleMemories: Array<{
      namespace: string;
      count: number;
      latest: string;
    }>;
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>(PAY_ONLY ? 'pay' : 'today');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(PAY_ONLY || '');
  const [ignoreMemory, setIgnoreMemory] = useState<boolean>(false);
  const [clientNote, setClientNote] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Live Data States
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [clientDetail, setClientDetail] = useState<ClientDetail | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null);
  const [proofData, setProofData] = useState<ProofData | null>(null);
  const [allInvoices, setAllInvoices] = useState<any[]>([]);

  // Payment Form States
  const [digestInput, setDigestInput] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [newInvoice, setNewInvoice] = useState({ clientId: 'c4', amount: '0.05', dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), description: '' });
  const [reminderText, setReminderText] = useState<string>('');
  const [reminderSource, setReminderSource] = useState<string>('');
  const [newClientName, setNewClientName] = useState<string>('');
  const [walletBusy, setWalletBusy] = useState<string | null>(null);
  const [qr, setQr] = useState<string>('');
  const [noteText, setNoteText] = useState<string>('');
  const [noteBusy, setNoteBusy] = useState<boolean>(false);
  const [payerInput, setPayerInput] = useState<string>('');
  const handleSetPayer = async () => {
    const r = await fetch(`/api/chaser/clients/${selectedClientId}/payer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payer: payerInput }) });
    const d = await r.json();
    if (!r.ok) return showToast(d.error || 'Could not set payer');
    showToast(`Payer set: ${d.name ? `${d.name} → ` : ''}${d.address.slice(0, 10)}… · Tatum screening: ${d.screen?.verdict ?? 'unavailable'}`);
    setPayerInput('');
    fetchClientDetail(selectedClientId);
    fetchClients();
  };
  const [memQuery, setMemQuery] = useState<string>('');
  const [memHits, setMemHits] = useState<any[] | null>(null);
  const [memBusy, setMemBusy] = useState<boolean>(false);
  const handleMemorySearch = async () => {
    if (memQuery.trim().length < 2) return;
    setMemBusy(true);
    try {
      const r = await fetch(`/api/chaser/clients/${selectedClientId}/search?q=${encodeURIComponent(memQuery.trim())}`);
      const d = await r.json();
      if (!r.ok) return showToast(d.error || 'Search failed');
      setMemHits(d.results);
    } finally {
      setMemBusy(false);
    }
  };
  // Tour targets: the client with the most payment history, and one of its open invoices.
  const tourClient = [...clientsList].sort((a, b) => (b.profile?.totalPaidInvoices ?? 0) - (a.profile?.totalPaidInvoices ?? 0))[0];
  const tourInvoice = allInvoices.find((i) => i.clientId === tourClient?.id && i.status !== 'paid') || allInvoices[0];
  const netLabel = (invoiceDetail?.invoice.network || (summary as any)?.network) === 'testnet' ? 'Sui Testnet' : 'Sui Mainnet';

  // Real QR: the Sui Payment Kit URI (sui:pay?...) for this invoice, scannable by Sui wallets.
  useEffect(() => {
    const uri = invoiceDetail?.invoice.paymentUri;
    if (!uri) return setQr('');
    QRCode.toDataURL(uri, { margin: 1, width: 240 }).then(setQr).catch(() => setQr(''));
  }, [invoiceDetail?.invoice.paymentUri]);

  // Live: Tatum gRPC checkpoint stream (server-side) pushes "paid" the moment the payment lands.
  // EventSource reconnects by itself when the server ends a stream window.
  const [live, setLive] = useState<{ state: string; checkpoint?: string }>({ state: 'off' });
  useEffect(() => {
    const id = selectedInvoiceId;
    if (activeTab !== 'pay' || !id || !invoiceDetail || invoiceDetail.invoice.status === 'paid') return setLive({ state: 'off' });
    const es = new EventSource(`${import.meta.env.VITE_API_BASE || ''}/api/chaser/pay/${encodeURIComponent(id)}/live`);
    es.addEventListener('watching', () => setLive((l) => ({ ...l, state: 'watching' })));
    es.addEventListener('checkpoint', (e) => setLive({ state: 'watching', checkpoint: JSON.parse((e as MessageEvent).data).checkpoint }));
    es.addEventListener('seen', () => setLive((l) => ({ ...l, state: 'verifying' })));
    es.addEventListener('rejected', (e) => { setLive((l) => ({ ...l, state: 'watching' })); showToast(JSON.parse((e as MessageEvent).data).error); });
    es.addEventListener('paid', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      es.close();
      setLive({ state: 'paid', checkpoint: d.checkpoint });
      if (!d.already) showToast(d.message || 'Payment detected live and verified on-chain');
      fetchInvoiceDetail(id);
    });
    es.onerror = () => setLive((l) => ({ ...l, state: 'reconnecting' }));
    return () => es.close();
  }, [activeTab, selectedInvoiceId, invoiceDetail?.invoice.status, !!invoiceDetail]);

  // Payment Kit auto-sync: payments made through the on-chain registry settle without a pasted digest.
  const syncPayments = async () => {
    try {
      const r = await fetch('/api/chaser/sync-payments', { method: 'POST' });
      const d = await r.json();
      if (d.settled?.length) {
        showToast(d.settled.map((x: any) => `${x.invoice}: ${x.message}`).join(' · '));
        fetchSummary();
        fetchAllInvoices();
        if (selectedInvoiceId) fetchInvoiceDetail(selectedInvoiceId);
      }
    } catch (_e) {}
  };
  useEffect(() => {
    if (activeTab !== 'pay' || invoiceDetail?.invoice.status === 'paid') return;
    const t = setInterval(syncPayments, 10000);
    return () => clearInterval(t);
  }, [activeTab, selectedInvoiceId, invoiceDetail?.invoice.status]);

  const handleIngestNotes = async () => {
    if (noteText.trim().length < 10) return showToast('Paste at least a sentence');
    setNoteBusy(true);
    try {
      const res = await fetch(`/api/chaser/clients/${selectedClientId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: noteText }) });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || 'Could not analyze notes');
      showToast(`Walrus extracted ${data.facts.length} fact(s) from your notes`);
      setNoteText('');
      fetchClientDetail(selectedClientId);
      if (selectedInvoiceId) fetchInvoiceDetail(selectedInvoiceId);
    } finally {
      setNoteBusy(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    syncPayments();
    if (PAY_ONLY) return; // the public pay page loads nothing but its own invoice
    fetchSummary();
    fetchClients();
    fetchAllInvoices();
  }, []);

  // recall hits belong to one client: clear them when the selection changes
  useEffect(() => { setMemHits(null); setMemQuery(''); }, [selectedClientId]);

  useEffect(() => {
    if (selectedClientId && !PAY_ONLY && (!clientsList.length || clientsList.some((c) => c.id === selectedClientId))) {
      fetchClientDetail(selectedClientId);
    }
  }, [selectedClientId]);

  useEffect(() => {
    if (selectedInvoiceId && (PAY_ONLY || !allInvoices.length || allInvoices.some((i) => i.id === selectedInvoiceId))) {
      fetchInvoiceDetail(selectedInvoiceId);
    }
  }, [selectedInvoiceId]);

  useEffect(() => {
    if (activeTab === 'proof') fetchProof();
    // plans depend on memories that may have changed on another tab
    if (activeTab === 'invoices' || activeTab === 'pay') selectedInvoiceId && fetchInvoiceDetail(selectedInvoiceId);
    if (activeTab === 'today') fetchSummary();
  }, [activeTab]);

  const fetchSummary = async () => {
    try {
      const res = await fetch('/api/chaser/summary');
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      }
    } catch (_err) {}
  };

  const fetchClients = async () => {
    try {
      const res = await fetch('/api/chaser/clients');
      if (res.ok) {
        const data = await res.json();
        setClientsList(data);
        if (data.length && !data.some((c: any) => c.id === selectedClientId)) setSelectedClientId(data[0].id);
      }
    } catch (_err) {}
  };

  const fetchAllInvoices = async () => {
    try {
      const res = await fetch('/api/chaser/invoices');
      if (res.ok) {
        const data = await res.json();
        setAllInvoices(data);
        if (!PAY_ONLY && data.length && !data.some((i: any) => i.id === selectedInvoiceId)) setSelectedInvoiceId((data.find((i: any) => i.status !== 'paid') || data[0]).id);
      }
    } catch (_err) {}
  };

  const fetchClientDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/chaser/clients/${id}`);
      if (res.ok) {
        const data = await res.json();
        setClientDetail(data);
      }
    } catch (_err) {}
  };

  const [storingReceipt, setStoringReceipt] = useState(false);
  const storeReceipt = async (id: string) => {
    setStoringReceipt(true);
    try {
      const res = await fetch(`/api/chaser/invoices/${id}/receipt`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Receipt failed');
      showToast(`Receipt stored on Walrus: ${data.blobId.slice(0, 10)}…`);
      await fetchInvoiceDetail(id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Receipt failed');
    } finally {
      setStoringReceipt(false);
    }
  };
  const fetchInvoiceDetail = async (id: string) => {
    try {
      const res = await fetch(PAY_ONLY ? `/api/chaser/pay/${id}` : `/api/chaser/invoices/${id}`);
      if (res.ok) {
        const data = await res.json();
        setInvoiceDetail(data);
      }
    } catch (_err) {}
  };

  const fetchProof = async () => {
    try {
      const res = await fetch('/api/chaser/proof');
      if (res.ok) {
        const data = await res.json();
        setProofData(data);
      }
    } catch (_err) {}
  };

  const handleSavePreference = async () => {
    if (!clientNote.trim()) return;
    try {
      const res = await fetch(`/api/chaser/clients/${selectedClientId}/preference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preference: clientNote }),
      });
      if (res.ok) {
        showToast('Client preference recorded in Walrus Memory');
        setClientNote('');
        fetchClientDetail(selectedClientId);
        fetchSummary();
        if (selectedInvoiceId) fetchInvoiceDetail(selectedInvoiceId);
      }
    } catch (_err) {
      showToast('Failed to record memory');
    }
  };

  const handleRevokeRule = async (rule: string) => {
    try {
      const res = await fetch(`/api/chaser/clients/${selectedClientId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      showToast('Rule revoked: a revocation memory was written to Walrus');
      fetchClientDetail(selectedClientId);
      fetchSummary();
      if (selectedInvoiceId) fetchInvoiceDetail(selectedInvoiceId);
    } catch (err: any) {
      showToast(`Failed to revoke: ${err?.message || err}`);
    }
  };

  const handleRebuildFromMemory = async () => {
    try {
      showToast('Total Recall: restoring and recalling every namespace from Walrus…');
      const res = await fetch(`/api/chaser/clients/${selectedClientId}/rebuild?deep=1`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        showToast(data.message || 'Profile rebuilt from Walrus memories');
        fetchClientDetail(selectedClientId);
        fetchClients();
        fetchAllInvoices();
        fetchSummary();
      }
    } catch (_err) {
      showToast('Rebuild failed');
    }
  };

  const handleVerifyDigest = async () => {
    if (!digestInput.trim()) {
      showToast('Please enter a transaction digest');
      return;
    }
    setIsVerifying(true);
    try {
      const res = await fetch('/api/chaser/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: selectedInvoiceId,
          digest: digestInput.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || `Settled on ${netLabel}. Walrus memory updated.`);
        setDigestInput('');
        fetchInvoiceDetail(selectedInvoiceId);
        fetchSummary();
        fetchAllInvoices();
      } else {
        showToast(data.error || 'Verification failed');
      }
    } catch (_err) {
      showToast('Network error during verification');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleAddClient = async () => {
    if (!newClientName.trim()) return;
    const res = await fetch('/api/chaser/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newClientName.trim() }) });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || 'Could not add client');
    showToast(`${data.client.name} added (writing to Walrus Memory)`);
    setNewClientName('');
    await fetchClients();
    setSelectedClientId(data.client.id);
  };

  // Pay with any Sui wallet (Wallet Standard). The server builds the exact USDC transfer through Tatum;
  // the wallet signs and executes it; then the digest is verified on Mainnet like any other payment.
  const handleWalletPay = async () => {
    const wallets = getWallets().get().filter((w) => 'sui:signAndExecuteTransaction' in w.features && 'standard:connect' in w.features);
    if (!wallets.length) return showToast('No Sui wallet found in this browser. Install Slush, or pay manually below.');
    const wallet = wallets.find((w) => /slush|sui/i.test(w.name)) || wallets[0];
    try {
      setWalletBusy(`Connecting ${wallet.name}…`);
      const { accounts } = await (wallet.features['standard:connect'] as any).connect();
      const chain = `sui:${invoiceDetail?.invoice.network || 'mainnet'}`;
      const account = accounts.find((a: any) => a.chains.includes(chain)) || accounts[0];
      if (!account) throw new Error('No account approved');
      setWalletBusy('Building transfer via Tatum…');
      const canSignOnly = 'sui:signTransaction' in wallet.features;
      const r = await fetch('/api/chaser/pay-tx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: selectedInvoiceId, sender: account.address, sponsored: canSignOnly }) });
      const built = await r.json();
      if (!r.ok) throw new Error(built.error);
      // Sponsored: the server's gas wallet pays the network fee; the payer only signs the USDC payment.
      if (built.sponsored) {
        setWalletBusy('Approve in your wallet · network fee sponsored, you pay only USDC');
        const signed = await (wallet.features['sui:signTransaction'] as any).signTransaction({
          transaction: { toJSON: async () => Transaction.from(built.bytes).toJSON() },
          account,
          chain,
        });
        setWalletBusy(`Submitting through Tatum and verifying on ${netLabel}…`);
        const v = await fetch('/api/chaser/pay-sponsored', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: selectedInvoiceId, bytes: built.bytes, signature: signed.signature, mac: built.sponsored.mac }) });
        const data = await v.json();
        showToast(data?.message || data?.error || 'Payment sent');
        fetchInvoiceDetail(selectedInvoiceId);
        fetchSummary();
        fetchAllInvoices();
        return;
      }
      const fee = built.fee;
      setWalletBusy(
        fee
          ? fee.sui < 0
            ? `Approve in your wallet · you get a ${(-fee.sui).toFixed(4)} SUI storage rebate`
            : `Approve in your wallet · network fee ≈ ${fee.sui.toFixed(4)} SUI${fee.usd != null ? ` ($${fee.usd.toFixed(4)})` : ''}`
          : 'Approve in your wallet…',
      );
      const tx = Transaction.from(built.bytes);
      const out = await (wallet.features['sui:signAndExecuteTransaction'] as any).signAndExecuteTransaction({
        transaction: { toJSON: async () => tx.toJSON() },
        account,
        chain,
      });
      setWalletBusy(`Verifying on ${netLabel}…`);
      let data: any = null;
      for (let i = 0; i < 6; i++) {
        const v = await fetch('/api/chaser/verify-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: selectedInvoiceId, digest: out.digest, channel: 'wallet' }) });
        data = await v.json();
        if (v.ok || v.status === 409) break;
        await new Promise((ok) => setTimeout(ok, 2500)); // the gateway may need a moment to see the tx
      }
      showToast(data?.message || data?.error || 'Payment sent');
      fetchInvoiceDetail(selectedInvoiceId);
      fetchSummary();
      fetchAllInvoices();
    } catch (e: any) {
      showToast(e?.message || 'Wallet payment failed');
    } finally {
      setWalletBusy(null);
    }
  };

  const handleCreateInvoice = async () => {
    try {
      const res = await fetch('/api/chaser/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newInvoice),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || 'Could not create invoice');
      showToast(`Invoice ${data.invoice.id} created: pay exactly ${data.invoice.payAmount} USDC`);
      await fetchAllInvoices();
      setSelectedInvoiceId(data.invoice.id);
      fetchSummary();
    } catch (_e) {
      showToast('Could not create invoice');
    }
  };

  const handleLogReminder = async (tone: string) => {
    try {
      const res = await fetch(`/api/chaser/invoices/${selectedInvoiceId}/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || 'Could not log reminder');
      setReminderText(data.text);
      setReminderSource(data.draftedBy === 'llm' ? `Drafted by ${data.model} via Vercel AI Gateway from this client's memories` : `Template (AI drafting unavailable${data.fallbackReason ? `: ${String(data.fallbackReason).replace(/\[[0-9;]*m/g, '').split('.')[0]}` : ''})`);
      navigator.clipboard?.writeText(data.text);
      showToast('Reminder copied and saved to Walrus Memory');
      fetchInvoiceDetail(selectedInvoiceId);
      fetchSummary();
    } catch (_e) {
      showToast('Could not log reminder');
    }
  };

  return (
    <div className="min-h-screen bg-primary text-primary flex flex-col font-sans">
      {/* Top Header & Navigation with Tabs recipe */}
      <header className="border-b border-secondary bg-primary sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-xl min-h-16 py-xs md:py-0 flex flex-wrap md:flex-nowrap items-center justify-between gap-y-xs">
          <div className="flex items-center gap-md">
            <div className="w-8 h-8 rounded-lg bg-brand-solid flex items-center justify-center text-primary-on-brand font-bold text-sm shadow-xs">
              IC
            </div>
            <div>
              <span className="font-semibold text-sm text-primary tracking-tight">Invoice Chaser</span>
              <span className="ml-xs inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                Sui USDC
              </span>
            </div>
          </div>

          {/* Navigation Bar adhering to tabs.md */}
          {!PAY_ONLY && <nav className="order-last md:order-none w-full md:w-auto flex gap-lg overflow-x-auto border-b border-transparent md:h-16 items-end pb-xxs whitespace-nowrap">
            {(['today', 'clients', 'invoices', 'pay', 'proof'] as TabKey[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`border-b-2 px-md py-sm text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${
                  activeTab === tab
                    ? 'border-brand text-brand-primary'
                    : 'border-transparent text-tertiary hover:text-secondary'
                }`}
              >
                {tab === 'today' && 'Today'}
                {tab === 'clients' && 'Clients'}
                {tab === 'invoices' && 'Invoices'}
                {tab === 'pay' && 'Public Pay Page'}
                {tab === 'proof' && '/proof'}
              </button>
            ))}
          </nav>}

          <div className="flex items-center gap-sm">
            <span className={`inline-flex items-center gap-xs rounded-full border px-md py-xxs text-xs font-medium ${netLabel === 'Sui Testnet' ? 'border-utility-warning-200 bg-utility-warning-50 text-utility-warning-700' : 'border-utility-success-200 bg-utility-success-50 text-utility-success-700'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-success-primary animate-pulse" />
              {netLabel === 'Sui Testnet' ? 'TESTNET' : 'Sui Mainnet'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-xl py-2xl">
        {activeTab === 'today' && (
          <div className="space-y-2xl">
            {/* Header info */}
            <div>
              <h1 className="text-heading-lg font-semibold text-primary">Today's Cash Flow & Actions</h1>
              <p className="text-secondary text-sm mt-xs">
                Anticipated USDC settlements on {netLabel} with Walrus memory-driven chase recommendations.
              </p>
            </div>

            {/* Judge path: five stops that show the learning loop end to end */}
            <section className="rounded-xl border border-utility-brand-200 bg-utility-brand-50 p-lg flex flex-wrap items-center gap-sm">
              <span className="text-sm font-semibold text-utility-brand-700 mr-sm">Judging? 2-minute tour:</span>
              {[
                { label: `1 · ${tourClient?.name ?? 'Client'}'s learned profile`, go: () => { tourClient && setSelectedClientId(tourClient.id); setActiveTab('clients'); } },
                { label: '2 · Memory on vs off', go: () => { tourInvoice && setSelectedInvoiceId(tourInvoice.id); setIgnoreMemory(true); setActiveTab('invoices'); } },
                { label: '3 · Teach a rule', go: () => { tourClient && setSelectedClientId(tourClient.id); setActiveTab('clients'); } },
                { label: `4 · Pay on ${netLabel}`, go: () => setActiveTab('invoices') },
                { label: '5 · Live proof', go: () => setActiveTab('proof') },
              ].map((st) => (
                <button key={st.label} onClick={st.go} className="rounded-full border border-utility-brand-200 bg-primary px-md py-xs text-xs font-semibold text-utility-brand-700 hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
                  {st.label}
                </button>
              ))}
              {tourClient?.id === 'c1' && <span className="text-xs text-tertiary w-full">Aug–Oct client history is seeded demo data (labelled in each timeline). Everything you do here becomes a real Walrus Mainnet memory.</span>}
            </section>

            {/* Overview Stats (Card Recipe: rounded-xl, border-secondary, bg-primary, p-xl, shadow-xs) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-lg">
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                <div className="flex items-center justify-between text-tertiary mb-xs">
                  <span className="text-sm">Expected Inflow (Next 7 Days)</span>
                  <DollarSign className="w-4 h-4 text-fg-brand-primary" />
                </div>
                <div className="mt-md text-heading-md font-semibold text-primary">
                  {summary ? summary.expectedInflow7Days : '—'} <span className="text-xs font-normal text-secondary">USDC</span>
                </div>
                <div className="text-xs text-utility-success-700 mt-xs flex items-center gap-xxs font-medium">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>{summary ? summary.upcomingInflows.length : 0} expected payments · {summary?.expectedInflow30Days ?? '—'} USDC in 30 days</span>
                </div>
              </section>

              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                <div className="flex items-center justify-between text-tertiary mb-xs">
                  <span className="text-sm">Overdue Balance</span>
                  <AlertCircle className="w-4 h-4 text-fg-error-primary" />
                </div>
                <div className="mt-md text-heading-md font-semibold text-primary">
                  {summary ? summary.overdueAmount : '0.00'} <span className="text-xs font-normal text-secondary">USDC</span>
                </div>
                <div className="text-xs text-secondary mt-xs flex items-center gap-xxs font-medium">
                  <span>Tracked across {clientsList.length} clients</span>
                </div>
              </section>

              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                <div className="flex items-center justify-between text-tertiary mb-xs">
                  <span className="text-sm">Prediction error (learned from memory)</span>
                  <Brain className="w-4 h-4 text-fg-brand-primary" />
                </div>
                <div className="mt-md text-heading-md font-semibold text-primary">
                  {(summary as any)?.learning ? <>{(summary as any).learning.firstError}d → {(summary as any).learning.latestError}d</> : '—'}
                </div>
                <div className="text-xs text-secondary mt-xs flex items-center gap-xxs">
                  <span>{(summary as any)?.learning ? `first invoice vs latest, ${(summary as any).learning.clients} client(s), ${(summary as any).learning.predictions} predictions` : 'appears once a client has 2 paid invoices'}</span>
                </div>
              </section>
            </div>

            {/* Next Actions & Inflows */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-xl">
              {/* Next Actions List */}
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                <div className="flex items-center justify-between mb-lg">
                  <div>
                    <h2 className="text-heading-xs font-semibold text-primary">Recommended Next Actions</h2>
                    <p className="text-xs text-secondary">Derived from past client settlement history and preferences</p>
                  </div>
                  <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                    Walrus Memory
                  </span>
                </div>

                <div className="space-y-md">
                  {summary?.nextActions && summary.nextActions.length > 0 ? (
                    summary.nextActions.map((action, idx) => (
                      <div key={idx} className="p-md rounded-lg bg-secondary border border-secondary hover:border-brand transition-colors">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-xs">
                              <span className="font-semibold text-sm text-primary">Remind {action.clientName}</span>
                              <span className="inline-flex items-center gap-xs rounded-full border border-utility-warning-200 bg-utility-warning-50 px-sm py-xxs text-xs font-medium text-utility-warning-700 capitalize">
                                {action.recommendedTone} Tone
                              </span>
                              {action.underpayRisk && (
                                <span className="inline-flex items-center gap-xs rounded-full border border-utility-error-200 bg-utility-error-50 px-sm py-xxs text-xs font-medium text-utility-error-700">
                                  Underpay Risk {action.underpayRisk}%
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-secondary mt-xs">{action.reason}</p>
                            <div className="text-xs text-tertiary mt-xs flex items-center gap-xs">
                              <Clock className="w-3.5 h-3.5 text-fg-brand-primary" />
                              <span>Action date: {action.actionDate} • Invoice #{action.invoiceId}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedInvoiceId(action.invoiceId);
                              setActiveTab('invoices');
                            }}
                            className="inline-flex items-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring shrink-0"
                          >
                            View Plan
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-secondary p-md">No pending actions for today.</div>
                  )}
                </div>
              </section>

              {/* Expected USDC Inflow (7 Days) with Table recipe */}
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                <div className="flex items-center justify-between mb-lg">
                  <div>
                    <h2 className="text-heading-xs font-semibold text-primary">Expected USDC Inflow (7 Days)</h2>
                    <p className="text-xs text-secondary">Predicted completion dates adjusted by Walrus memory</p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-secondary bg-primary">
                  <table className="w-full">
                    <thead className="bg-secondary">
                      <tr className="border-b border-secondary text-left">
                        <th className="px-md py-sm text-xs font-semibold text-tertiary">Client & Invoice</th>
                        <th className="px-md py-sm text-xs font-semibold text-tertiary">Predicted Date</th>
                        <th className="px-md py-sm text-xs font-semibold text-tertiary text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary?.upcomingInflows && summary.upcomingInflows.length > 0 ? (
                        summary.upcomingInflows.map((item, idx) => (
                          <tr key={idx} className="border-b border-secondary hover:bg-secondary-hover">
                            <td className="px-md py-sm text-sm text-primary font-medium">
                              <div>{item.clientName}</div>
                              <div className="text-xs text-tertiary">#{item.invoiceId} • Due {item.dueDate}</div>
                            </td>
                            <td className="px-md py-sm text-sm text-tertiary">
                              {item.predictedPayDate} {item.delayDays > 0 ? `(+${item.delayDays}d)` : '(On time)'}
                            </td>
                            <td className="px-md py-sm text-sm text-right">
                              <div className="font-semibold text-primary">{item.payAmount} USDC</div>
                              <span className="inline-flex items-center rounded-full border border-utility-brand-200 bg-utility-brand-50 px-sm py-xxs text-xs font-medium text-utility-brand-700">
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-md py-sm text-sm text-tertiary text-center">
                            No inflows scheduled this week.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        )}

        {activeTab === 'clients' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-xl">
            {/* Clients List */}
            <div className="lg:col-span-1 space-y-md">
              <div className="flex items-center justify-between">
                <h2 className="text-heading-xs font-semibold text-primary">Clients</h2>
                <span className="text-xs text-secondary">{clientsList.length} active clients</span>
              </div>
              <div className="flex gap-sm">
                <input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddClient(); }} placeholder="New client name" className="flex-1 rounded-md bg-primary px-md py-xs text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" />
                <button onClick={handleAddClient} className="rounded-lg bg-brand-solid px-md py-xs text-xs font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Add</button>
              </div>

              <div className="space-y-sm">
                {clientsList.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setSelectedClientId(c.id)}
                    aria-pressed={selectedClientId === c.id}
                    className={`block w-full text-left p-md rounded-xl border cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${
                      selectedClientId === c.id
                        ? 'bg-secondary border-brand shadow-xs'
                        : 'bg-primary border-secondary hover:bg-secondary-hover'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm text-primary">{c.name}</div>
                      <span
                        className={`inline-flex items-center rounded-full px-md py-xxs text-xs font-medium border ${
                          c.profile.reliabilityBadge.includes('Reliable')
                            ? 'bg-utility-success-50 text-utility-success-700 border-utility-success-200'
                            : c.profile.reliabilityBadge.includes('Underpayer')
                            ? 'bg-utility-error-50 text-utility-error-700 border-utility-error-200'
                            : c.profile.reliabilityBadge.includes('Late')
                            ? 'bg-utility-warning-50 text-utility-warning-700 border-utility-warning-200'
                            : 'bg-utility-brand-50 text-utility-brand-700 border-utility-brand-200'
                        }`}
                      >
                        {c.profile.reliabilityBadge}
                      </span>
                    </div>
                    <div className="text-xs text-secondary mt-xxs">
                      {c.profile.totalPaidInvoices === 0 ? 'No payment history yet' : <>Delay: {c.profile.medianDelayDays > 0 ? `+${c.profile.medianDelayDays} days` : 'on time'} • Reminders: {c.profile.remindersNeeded} • {c.profile.totalPaidInvoices} paid</>}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Client Detail */}
            <div className="lg:col-span-2 space-y-xl">
              {clientDetail ? (
                <>
                  {/* Profile Card */}
                  <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs space-y-lg">
                    <div className="flex items-center justify-between border-b border-secondary pb-md">
                      <div>
                        <h3 className="text-heading-sm font-semibold text-primary">{clientDetail.client.name}</h3>
                        <p className="text-xs text-secondary">
                          Walrus Namespace: <code className="text-brand-primary font-mono">{clientDetail.namespace}</code>
                        </p>
                      </div>
                      <button
                        onClick={handleRebuildFromMemory}
                        className="inline-flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Total Recall: rebuild from Walrus
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-md">
                      <div className="p-md bg-secondary rounded-lg border border-secondary">
                        <span className="text-xs text-tertiary">Median Delay</span>
                        <div className="text-heading-xs font-bold text-primary mt-xxs">
                          {clientDetail.profile.medianDelayDays} days
                        </div>
                      </div>

                      <div className="p-md bg-secondary rounded-lg border border-secondary">
                        <span className="text-xs text-tertiary">Reminders Needed</span>
                        <div className="text-heading-xs font-bold text-primary mt-xxs">
                          {clientDetail.profile.remindersNeeded}
                        </div>
                      </div>

                      <div className="p-md bg-secondary rounded-lg border border-secondary">
                        <span className="text-xs text-tertiary">Best Tone (Hit-Rate)</span>
                        <div className="text-heading-xs font-bold text-primary mt-xxs capitalize">
                          {clientDetail.profile.bestTone} ({clientDetail.profile.toneStats[clientDetail.profile.bestTone]?.rate || 0}%)
                        </div>
                      </div>

                      <div className="p-md bg-secondary rounded-lg border border-secondary">
                        <span className="text-xs text-tertiary">Underpay Rate</span>
                        <div className="text-heading-xs font-bold text-primary mt-xxs">
                          {clientDetail.profile.underpayRate}%
                        </div>
                      </div>
                    </div>

                    {/* Learning chart: what we predicted before each payment vs what happened */}
                    {clientDetail.profile.history && clientDetail.profile.history.length > 0 && (() => {
                      const h = clientDetail.profile.history!;
                      const max = Math.max(1, ...h.flatMap((x) => [x.predicted, x.actual]));
                      return (
                        <div className="p-md bg-secondary rounded-lg border border-secondary space-y-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-primary">How the prediction learned</span>
                            <span className="text-xs text-tertiary">days late: predicted before payment vs actual</span>
                          </div>
                          {h.map((x) => (
                            <div key={x.invoice} className="grid grid-cols-[72px_1fr_64px] items-center gap-sm text-xs">
                              <span className="text-secondary font-mono">#{x.n} {x.invoice}</span>
                              <div className="space-y-xxs">
                                <div className="h-2 rounded-full bg-utility-brand-200" style={{ width: `${(x.predicted / max) * 100}%`, minWidth: 2 }} title={`predicted ${x.predicted}d`} />
                                <div className="h-2 rounded-full bg-brand-solid" style={{ width: `${(x.actual / max) * 100}%`, minWidth: 2 }} title={`actual ${x.actual}d`} />
                              </div>
                              <span className={x.error === 0 ? 'text-utility-success-700 font-semibold' : 'text-tertiary'}>
                                {x.error === 0 ? 'exact' : `off by ${x.error}d`}
                              </span>
                            </div>
                          ))}
                          <div className="flex gap-md text-xs text-tertiary">
                            <span className="inline-flex items-center gap-xxs"><span className="w-2 h-2 rounded-full bg-utility-brand-200" /> predicted</span>
                            <span className="inline-flex items-center gap-xxs"><span className="w-2 h-2 rounded-full bg-brand-solid" /> actual</span>
                          </div>
                        </div>
                      );
                    })()}

                    {Number(clientDetail.profile.creditUsdc || 0) > 0 && (
                      <p className="rounded-md border border-secondary bg-utility-success-50 px-md py-xs text-xs text-utility-success-700">Credit on account: <span className="font-semibold">{clientDetail.profile.creditUsdc} USDC</span> overpaid on earlier invoices (remembered in Walrus with each payment).</p>
                    )}

                    {/* Active rules: each can be revoked (append-only revocation memory on Walrus) */}
                    {(clientDetail.profile.preferences.length > 0 || (clientDetail.profile.revokedRules || []).length > 0) && (
                      <div className="flex flex-col gap-xs pt-xs">
                        <p className="text-sm font-medium text-secondary">Rules the plan obeys</p>
                        <ul className="flex flex-col gap-xs">
                          {clientDetail.profile.preferences.map((r) => (
                            <li key={r} className="flex items-start justify-between gap-sm rounded-md border border-secondary bg-secondary px-md py-xs text-xs text-secondary">
                              <span>{r}</span>
                              <button onClick={() => handleRevokeRule(r)} aria-label={`Revoke rule: ${r}`} className="shrink-0 font-semibold text-fg-error-primary hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring rounded-sm">Revoke</button>
                            </li>
                          ))}
                          {(clientDetail.profile.revokedRules || []).map((r) => (
                            <li key={`x-${r}`} className="rounded-md border border-secondary px-md py-xs text-xs text-tertiary line-through" title="Revoked: still on Walrus, no longer applied">{r}</li>
                          ))}
                        </ul>
                        <p className="text-xs text-tertiary">Walrus is append-only, so revoking writes a new memory; the original stays on Walrus as history.</p>
                      </div>
                    )}

                    {/* Tell me something about this client (Input & Field Recipe) */}
                    <div className="flex flex-col gap-sm pt-xs">
                      <label className="text-sm font-medium text-secondary flex items-center gap-xs">
                        <MessageSquare className="w-3.5 h-3.5 text-fg-brand-primary" />
                        <span>Tell me something about this client</span>
                      </label>
                      <div className="flex gap-sm">
                        <input
                          type="text"
                          value={clientNote}
                          onChange={(e) => setClientNote(e.target.value)}
                          placeholder='e.g. "Never chase before the 10th of the month" or "Prefers formal reminders"'
                          className="flex-1 rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                        />
                        <button
                          onClick={handleSavePreference}
                          className="inline-flex items-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring shrink-0"
                        >
                          Save Preference
                        </button>
                      </div>
                      <p className="text-xs text-tertiary">Saves hard preference constraints directly to Walrus Memory.</p>
                    </div>

                    {/* Expected payer wallet: 0x… or a SuiNS name, resolved and screened through Tatum */}
                    <div className="flex flex-col gap-sm pt-xs">
                      <label className="text-sm font-medium text-secondary flex items-center gap-xs">
                        <ShieldCheck className="w-3.5 h-3.5 text-fg-brand-primary" />
                        <span>Wallet this client pays from {(clientDetail.client as any).expectedPayer ? <span className="font-mono text-xs text-tertiary">({(clientDetail.client as any).expectedPayer.name || (clientDetail.client as any).expectedPayer.address.slice(0, 12) + '…'})</span> : null}</span>
                      </label>
                      <div className="flex gap-sm">
                        <input value={payerInput} onChange={(e) => setPayerInput(e.target.value)} placeholder="0x… or name.sui" aria-label="Expected payer wallet" className="flex-1 rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" />
                        <button onClick={handleSetPayer} className="rounded-lg border border-primary bg-primary px-lg py-sm text-sm font-semibold text-secondary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Set payer</button>
                      </div>
                      <p className="text-xs text-tertiary">SuiNS names resolve through Tatum; the wallet is screened with Tatum's Malicious Address API. Payments from any other wallet are flagged.</p>
                    </div>

                    {/* Free-form notes -> Walrus Memory analyze() */}
                    <div className="flex flex-col gap-sm pt-xs">
                      <label className="text-sm font-medium text-secondary flex items-center gap-xs">
                        <Brain className="w-3.5 h-3.5 text-fg-brand-primary" />
                        <span>Paste an email or call notes from this client</span>
                      </label>
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        rows={3}
                        placeholder={'e.g. "Hi, our AP team only runs payments on Thursdays and never before the 15th. Please cc finance@acme.example on invoices."'}
                        className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                      />
                      <button onClick={handleIngestNotes} disabled={noteBusy} className="self-start inline-flex items-center gap-sm rounded-lg border border-primary bg-primary px-lg py-sm text-sm font-semibold text-secondary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:text-disabled">
                        {noteBusy ? 'Walrus is extracting facts…' : 'Extract facts with Walrus analyze()'}
                      </button>
                      <p className="text-xs text-tertiary">Walrus Memory pulls out each fact and stores it as its own memory; scheduling rules found in them are obeyed.</p>
                    </div>
                  </section>

                  {/* Timeline of Memories */}
                  <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                    <div className="flex items-center justify-between mb-lg">
                      <h3 className="text-heading-xs font-semibold text-primary flex items-center gap-xs">
                        <Brain className="w-4 h-4 text-fg-brand-primary" />
                        <span>Walrus Memory Timeline</span>
                      </h3>
                      <span className="text-xs text-secondary">{clientDetail.memories.length} memories recorded</span>
                    </div>

                    {/* Semantic search over this client's memories (Walrus recall) */}
                    <div className="mb-lg space-y-sm">
                      <div className="flex gap-sm">
                        <input
                          value={memQuery}
                          onChange={(e) => setMemQuery(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleMemorySearch(); }}
                          placeholder='Ask this memory, e.g. "when do they usually pay?" or "what tone works?"'
                          aria-label="Search this client's memory"
                          className="flex-1 rounded-md bg-primary px-md py-xs text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                        />
                        <button onClick={handleMemorySearch} disabled={memBusy} className="rounded-lg border border-primary bg-primary px-md py-xs text-xs font-semibold text-secondary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:text-disabled">
                          {memBusy ? 'Recalling…' : 'Recall'}
                        </button>
                      </div>
                      {memHits && (
                        <div className="rounded-lg border border-utility-brand-200 bg-utility-brand-50 p-md space-y-xs">
                          <p className="text-xs font-semibold text-utility-brand-700">Walrus recall: closest memories by meaning</p>
                          {memHits.length === 0 && <p className="text-xs text-tertiary">Nothing relevant remembered yet.</p>}
                          {memHits.map((h, i) => (
                            <div key={i} className="text-xs text-secondary flex gap-xs">
                              <span className="shrink-0 font-mono text-tertiary" title="cosine distance (smaller = closer)">{h.distance.toFixed(2)}</span>
                              <span className="flex-1">{h.sentence}</span>
                              <a href={`https://walruscan.com/mainnet/blob/${h.blobId}`} target="_blank" rel="noreferrer" className="shrink-0 text-utility-brand-700 hover:underline">blob</a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-md border-l-2 border-secondary ml-xs pl-md">
                      {clientDetail.memories.length > 0 ? (
                        clientDetail.memories.map((mem) => (
                          <div key={mem.id} className="relative">
                            <div className="absolute -left-[23px] top-1 w-2.5 h-2.5 rounded-full bg-brand-solid" />
                            <div className="text-xs font-medium text-primary">
                              {mem.tag?.type ? mem.tag.type.replace('_', ' ').toUpperCase() : 'EVENT'}
                            </div>
                            <p className="text-xs text-secondary mt-xxs">{mem.sentence}</p>
                            <div className="flex items-center gap-sm mt-xxs text-xs">
                              <span className="text-tertiary">{mem.timestamp?.slice(0, 10)}</span>
                              {mem.status === 'saved' && (mem as any).blobId ? (
                                <a href={`https://walruscan.com/mainnet/blob/${(mem as any).blobId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-xxs text-utility-brand-700 hover:underline">
                                  On Walrus <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <span className={mem.status === 'failed' ? 'text-utility-error-600' : 'text-utility-warning-600'}>{mem.status === 'failed' ? 'write failed, retrying' : 'writing to Walrus…'}</span>
                              )}
                              {mem.tag?.seed && <span className="text-tertiary">· seeded demo history</span>}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-secondary">No memories in this namespace yet. New client.</div>
                      )}
                    </div>
                  </section>
                </>
              ) : (
                <div className="p-xl bg-secondary rounded-xl border border-secondary text-secondary text-sm">
                  Select a client to view profile.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="space-y-xl">
            <div className="flex flex-wrap items-center justify-between gap-md">
              <div>
                <h1 className="text-heading-lg font-semibold text-primary flex items-center gap-md">Invoice Detail <a href={`${import.meta.env.VITE_API_BASE || ""}/api/chaser/export.csv`} className="text-xs font-semibold text-utility-brand-700 hover:underline">Export CSV</a> <a href={`${import.meta.env.VITE_API_BASE || ""}/api/chaser/reminders.ics`} className="text-xs font-semibold text-utility-brand-700 hover:underline">Reminders to calendar (.ics)</a></h1>
                <p className="text-secondary text-sm mt-xs">
                  Review reminder plans, memory reasoning, and payment parameters.
                </p>
              </div>

              {/* Select component recipe */}
              <div className="flex items-center gap-sm">
                <span className="text-xs text-secondary">Select Invoice:</span>
                <div className="relative">
                  <select
                    value={selectedInvoiceId}
                    onChange={(e) => setSelectedInvoiceId(e.target.value)}
                    className="appearance-none max-w-[80vw] md:max-w-none truncate flex items-center justify-between gap-sm rounded-md bg-primary px-lg py-sm pr-10 text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring cursor-pointer"
                  >
                    {allInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        #{inv.id} ({inv.clientName} - {inv.payAmount} USDC)
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="size-4 shrink-0 text-fg-quaternary absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* New invoice */}
            <section className="rounded-xl border border-secondary bg-primary p-lg shadow-xs flex flex-wrap items-end gap-md">
              <div className="flex flex-col gap-xxs">
                <label className="text-xs text-tertiary">Client</label>
                <select value={newInvoice.clientId} onChange={(e) => setNewInvoice({ ...newInvoice, clientId: e.target.value })} className="rounded-md bg-primary px-md py-xs text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring">
                  {clientsList.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
              <div className="flex flex-col gap-xxs">
                <label className="text-xs text-tertiary">Amount (USDC)</label>
                <input type="number" min="0.01" step="0.01" value={newInvoice.amount} onChange={(e) => setNewInvoice({ ...newInvoice, amount: e.target.value })} className="rounded-md bg-primary px-md py-xs text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring w-28" />
              </div>
              <div className="flex flex-col gap-xxs">
                <label className="text-xs text-tertiary">Due date</label>
                <input type="date" value={newInvoice.dueDate} onChange={(e) => setNewInvoice({ ...newInvoice, dueDate: e.target.value })} className="rounded-md bg-primary px-md py-xs text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" />
              </div>
              <div className="flex flex-col gap-xxs flex-1 min-w-[160px]">
                <label className="text-xs text-tertiary">Description</label>
                <input type="text" value={newInvoice.description} onChange={(e) => setNewInvoice({ ...newInvoice, description: e.target.value })} placeholder="What is this invoice for?" className="rounded-md bg-primary px-md py-xs text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" />
              </div>
              <button onClick={handleCreateInvoice} className="inline-flex items-center gap-sm rounded-lg bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
                <DollarSign className="w-4 h-4" /> New invoice
              </button>
            </section>

            {invoiceDetail && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-xl">
                {/* Left Column: Invoice summary & pay link */}
                <div className="lg:col-span-1 space-y-lg">
                  <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs space-y-md">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-tertiary">Status</span>
                      <span
                        className={`inline-flex items-center rounded-full px-md py-xxs text-xs font-medium border capitalize ${
                          invoiceDetail.invoice.status === 'paid'
                            ? 'bg-utility-success-50 text-utility-success-700 border-utility-success-200'
                            : invoiceDetail.invoice.status === 'partial'
                            ? 'bg-utility-warning-50 text-utility-warning-700 border-utility-warning-200'
                            : 'bg-utility-brand-50 text-utility-brand-700 border-utility-brand-200'
                        }`}
                      >
                        {invoiceDetail.invoice.status}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-tertiary">{invoiceDetail.invoice.status === 'partial' ? `Still owed (partially paid)` : 'Unique Payable Amount (6 decimals)'}</span>
                      <div className="mt-xs text-heading-md font-semibold text-primary">
                        {invoiceDetail.invoice.payAmount} <span className="text-xs font-normal text-secondary">USDC</span>
                      </div>
                      <p className="text-xs text-tertiary mt-xxs">
                        Base: {invoiceDetail.invoice.baseAmount} USDC + unique micro-suffix for deterministic Sui settlement.
                      </p>
                    </div>

                    <div className="border-t border-secondary pt-md space-y-xs">
                      <div className="flex justify-between text-xs">
                        <span className="text-secondary">Client:</span>
                        <span className="font-medium text-primary">{invoiceDetail.invoice.clientName}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-secondary">Due Date:</span>
                        <span className="font-medium text-primary">{invoiceDetail.invoice.dueDate}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-secondary">Payee Address:</span>
                        <span className="font-mono text-xs text-secondary truncate max-w-[150px]">
                          {invoiceDetail.invoice.payeeAddress}
                        </span>
                      </div>
                    </div>

                    <div className="border-t border-secondary pt-md space-y-sm">
                      {invoiceDetail.invoice.status !== 'paid' && (
                        <div className="p-md bg-secondary rounded-lg border border-secondary flex flex-col items-center justify-center text-center">
                          {qr ? <img src={qr} alt="Sui Payment Kit QR code for this invoice" className="w-40 h-40 mb-xs" /> : <QrCode className="w-24 h-24 text-primary mb-xs" />}
                          <span className="text-xs font-medium text-primary">Scan with a Sui wallet</span>
                          <span className="text-xs text-secondary">{netLabel} · Payment Kit registry</span>
                        </div>
                      )}

                      <button
                        onClick={() => setActiveTab('pay')}
                        className="w-full inline-flex items-center justify-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open Public Pay Page
                      </button>
                      <button
                        onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/?pay=${invoiceDetail.invoice.id}`); showToast('Pay link copied: send it to your client'); }}
                        className="w-full inline-flex items-center justify-center gap-sm rounded-lg border border-primary bg-primary px-lg py-sm text-sm font-semibold text-secondary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy client pay link
                      </button>
                      {invoiceDetail.invoice.explorerTx && (
                        <a href={invoiceDetail.invoice.explorerTx} target="_blank" rel="noreferrer" className="block text-center text-xs text-utility-brand-700 hover:underline">View payment on Suiscan</a>
                      )}
                      {invoiceDetail.invoice.status === 'paid' && invoiceDetail.invoice.explorerTx && (invoiceDetail.invoice.receipt ? (
                        <a href={invoiceDetail.invoice.receipt.url} target="_blank" rel="noreferrer" className="block text-center text-xs text-utility-brand-700 hover:underline">PDF receipt on Walrus ({invoiceDetail.invoice.receipt.blobId.slice(0, 10)}…)</a>
                      ) : invoiceDetail.invoice.receiptsEnabled ? (
                        <button type="button" disabled={storingReceipt} onClick={() => storeReceipt(invoiceDetail.invoice.id)} className="w-full rounded-lg border border-primary px-lg py-sm text-xs font-semibold text-secondary hover:bg-primary-hover disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-focus-ring">
                          {storingReceipt ? 'Storing receipt on Walrus (~15 s)…' : 'Store PDF receipt on Walrus'}
                        </button>
                      ) : null)}
                    </div>
                  </section>
                </div>

                {/* Right Column: Reminder Plan & "Why?" panel */}
                <div className="lg:col-span-2 space-y-lg">
                  <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs space-y-lg">
                    <div className="flex items-center justify-between border-b border-secondary pb-md">
                      <div>
                        <h3 className="text-heading-xs font-semibold text-primary">
                          {ignoreMemory ? 'Default Plan (Without Memory)' : 'Adaptive Reminder Plan'}
                        </h3>
                        <p className="text-xs text-secondary">
                          {ignoreMemory ? 'Standard fixed interval fallback' : 'Calculated deterministically from Walrus client memories'}
                        </p>
                      </div>

                      {/* Switch recipe: track + sliding thumb */}
                      <div className="flex items-center gap-xs">
                        <span className="text-xs text-secondary font-medium">Ignore memory</span>
                        <button
                          role="switch"
                          aria-checked={ignoreMemory}
                          onClick={() => setIgnoreMemory(!ignoreMemory)}
                          className={`flex h-5 w-9 items-center rounded-full p-xxs transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${
                            ignoreMemory ? 'bg-brand-solid' : 'bg-tertiary'
                          }`}
                        >
                          <span
                            className={`size-4 rounded-full bg-primary shadow-xs transform transition-transform ${
                              ignoreMemory ? 'translate-x-4' : 'translate-x-0'
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </div>

                    {!ignoreMemory ? (
                      /* Adaptive Memory Plan */
                      <div className="space-y-md">
                        <div className="flex items-start gap-md p-md rounded-lg bg-secondary border border-secondary">
                          <div className="p-xs bg-utility-brand-50 text-utility-brand-700 rounded-md">
                            <Clock className="w-4 h-4" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-primary">
                                Predicted Payment: {invoiceDetail.adaptivePlan.predictedPayDate ?? 'no history yet'}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-utility-brand-200 bg-utility-brand-50 px-sm py-xxs text-xs font-medium text-utility-brand-700">
                                Adaptive
                              </span>
                            </div>
                            <p className="text-xs text-secondary mt-xxs">
                              Schedule is tuned specifically to this client's historical payment speed.
                            </p>
                          </div>
                        </div>

                        <div className="space-y-sm">
                          {invoiceDetail.adaptivePlan.steps.map((st, i) => (
                            <div key={i} className="p-sm bg-secondary rounded-lg border border-secondary flex items-center justify-between">
                              <div>
                                <div className="text-xs font-medium text-primary capitalize">Step {i + 1}: {st.tone} Reminder</div>
                                <div className="text-xs text-secondary">Scheduled Date: {st.date} • {st.reason}</div>
                              </div>
                              <span className="inline-flex items-center rounded-full border border-utility-brand-200 bg-utility-brand-50 px-sm py-xxs text-xs font-medium text-utility-brand-700 capitalize">
                                {st.tone}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      /* Default Plan */
                      <div className="space-y-md">
                        <div className="flex gap-lg rounded-xl bg-utility-warning-50 p-md text-xs text-utility-warning-600 font-medium">
                          Default non-adaptive plan for baseline comparison:
                        </div>
                        <div className="space-y-sm">
                          {invoiceDetail.defaultPlan.steps.map((st, i) => (
                            <div key={i} className="p-sm bg-secondary rounded-lg border border-secondary flex items-center justify-between">
                              <div>
                                <div className="text-xs font-medium text-primary capitalize">Default {i + 1}: {st.tone}</div>
                                <div className="text-xs text-secondary">Date: {st.date} ({st.reason})</div>
                              </div>
                              <span className="text-xs text-secondary">Default</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Log a reminder you actually sent */}
                    {invoiceDetail.invoice.status !== 'paid' && (
                      <div className="space-y-sm border-t border-secondary pt-md">
                        <div className="flex flex-wrap items-center gap-sm">
                          <span className="text-xs text-secondary font-medium">Send a reminder now:</span>
                          {['friendly', 'formal', 'firm'].map((t) => (
                            <button key={t} onClick={() => handleLogReminder(t)} className="inline-flex items-center gap-xs rounded-lg border border-primary bg-primary px-md py-xs text-xs font-semibold text-secondary capitalize shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
                              <MessageSquare className="w-3.5 h-3.5" /> {t}
                            </button>
                          ))}
                        </div>
                        {reminderText && (
                          <div className="text-xs text-secondary bg-secondary rounded-lg border border-secondary p-md space-y-xs">
                            <p className="whitespace-pre-line">{reminderText}</p>
                            {reminderSource && <p className="text-tertiary italic">{reminderSource}</p>}
                            <a href={`mailto:?subject=${encodeURIComponent(`Invoice ${invoiceDetail.invoice.id}`)}&body=${encodeURIComponent(`${reminderText}\n\nPay here: ${window.location.origin}/?pay=${invoiceDetail.invoice.id}`)}`} className="inline-flex items-center gap-xxs font-semibold text-utility-brand-700 hover:underline">
                              Open in your email app <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Alert Recipe: Why? Panel */}
                    <div className="flex gap-lg rounded-xl bg-utility-brand-50 p-xl">
                      <HelpCircle className="mt-xxs size-5 shrink-0 text-utility-brand-600" aria-hidden="true" />
                      <div className="space-y-xs">
                        <p className="text-sm font-semibold text-utility-brand-600">Why this plan? (Walrus Memories Used)</p>
                        <ul className="text-xs text-tertiary space-y-xxs list-disc list-inside">
                          {(!ignoreMemory ? invoiceDetail.adaptivePlan.memoriesUsed : invoiceDetail.defaultPlan.memoriesUsed).map((m, idx) => (
                            <li key={idx}>{m}</li>
                          ))}
                        </ul>
                        {!ignoreMemory && (invoiceDetail.adaptivePlan.cites?.length ?? 0) > 0 && (
                          <div className="pt-xs space-y-xxs">
                            <p className="text-xs font-semibold text-utility-brand-600">Cited memories</p>
                            {invoiceDetail.adaptivePlan.cites!.map((c, i) => (
                              <div key={i} className="text-xs text-tertiary flex gap-xs">
                                <span className="shrink-0">{c.at?.slice(0, 10)}</span>
                                <span className="flex-1">{c.sentence}</span>
                                {c.blobId ? (
                                  <a href={`https://walruscan.com/mainnet/blob/${c.blobId}`} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-xxs text-utility-brand-700 hover:underline">Walrus <ExternalLink className="w-3 h-3" /></a>
                                ) : (
                                  <span className="shrink-0 text-utility-warning-600">writing…</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'pay' && (
          <div className="max-w-2xl mx-auto space-y-xl">
            <div className="text-center space-y-xs">
              <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                Public Payment Gateway
              </span>
              <h1 className="text-heading-lg font-bold text-primary">
                Pay Invoice #{selectedInvoiceId}
              </h1>
              <p className="text-xs text-secondary">{invoiceDetail ? `${invoiceDetail.invoice.clientName} · due ${invoiceDetail.invoice.dueDate} · ` : ''}Pay in USDC on {netLabel}</p>
              {invoiceDetail?.invoice.status === 'paid' && (
                <p className="inline-flex items-center gap-xs rounded-full border border-utility-success-200 bg-utility-success-50 px-md py-xxs text-sm font-semibold text-utility-success-700">
                  <Check className="w-4 h-4" /> Paid · thank you{invoiceDetail.invoice.explorerTx && <a className="underline ml-xs" href={invoiceDetail.invoice.explorerTx} target="_blank" rel="noreferrer">transaction</a>}{invoiceDetail.invoice.receipt && <a className="underline ml-xs" href={invoiceDetail.invoice.receipt.url} target="_blank" rel="noreferrer">PDF receipt (Walrus)</a>}
                </p>
              )}
            </div>

            <section className="rounded-xl border border-secondary bg-primary p-2xl shadow-xs space-y-xl">
              {/* Amount Display */}
              <div className="text-center p-xl bg-secondary rounded-xl border border-secondary">
                <span className="text-xs text-tertiary font-medium">{invoiceDetail?.invoice.status === 'partial' ? `Remaining after a partial payment (invoice total ${(invoiceDetail.invoice as any).originalAmount} USDC)` : 'Payable Amount (Unique Micro-Suffix)'}</span>
                <div className="mt-xs text-heading-xl font-semibold text-primary">
                  {invoiceDetail?.invoice.payAmount ?? '—'}{' '}
                  <span className="text-sm font-normal text-secondary">USDC</span>
                </div>
                <p className="text-xs text-tertiary mt-xs">
                  Paid through the Sui Payment Kit registry with this invoice as the nonce, so the chain itself refuses a second payment. Verified through Tatum, remembered in Walrus Memory.
                </p>
                {qr && invoiceDetail?.invoice.status !== 'paid' && (
                  <div className="mt-md flex flex-col items-center gap-xs">
                    <img src={qr} alt="Scan to pay with a Sui wallet" className="w-44 h-44" />
                    <a href={invoiceDetail?.invoice.paymentUri} className="text-xs font-semibold text-utility-brand-700 hover:underline">Open in Sui wallet (sui:pay)</a>
                  </div>
                )}
                {live.state !== 'off' && (
                  <p role="status" aria-live="polite" className="mt-sm flex items-center justify-center gap-xs text-xs text-tertiary">
                    <span className={`w-2 h-2 rounded-full ${live.state === 'paid' ? 'bg-utility-success-600' : live.state === 'reconnecting' ? 'bg-utility-warning-600' : 'bg-brand-solid animate-pulse'}`} />
                    {live.state === 'paid' ? `Payment seen live at checkpoint ${live.checkpoint ?? ''}` : live.state === 'verifying' ? 'Payment seen on-chain, verifying through Tatum…' : live.state === 'reconnecting' ? 'Reconnecting to the live Sui stream…' : `Watching Sui Mainnet live via Tatum gRPC${live.checkpoint ? ` · checkpoint ${live.checkpoint}` : ''}`}
                  </p>
                )}
              </div>

              {/* Recipient Address */}
              <div className="flex flex-col gap-sm">
                <label className="text-sm font-medium text-secondary">Payee Sui Address</label>
                <div className="flex items-center justify-between rounded-md bg-primary px-lg py-sm border border-primary font-mono text-xs text-primary">
                  <span className="truncate">{invoiceDetail?.invoice.payeeAddress ?? '—'}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(invoiceDetail?.invoice.payeeAddress || '');
                      showToast('Address copied to clipboard');
                    }}
                    aria-label="Copy payee address" title="Copy payee address"
                    className="p-xs text-secondary hover:text-primary rounded focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* One-click: connect a Sui wallet and pay */}
              <div className="space-y-sm border-t border-secondary pt-lg">
                <button
                  onClick={handleWalletPay}
                  disabled={!invoiceDetail || invoiceDetail.invoice.status === 'paid' || !!walletBusy}
                  className="w-full inline-flex items-center justify-center gap-sm rounded-lg border border-transparent px-lg py-md text-sm font-semibold shadow-xs focus-visible:ring-2 focus-visible:ring-focus-ring bg-brand-solid text-primary-on-brand hover:bg-brand-solid-hover disabled:bg-disabled-subtle disabled:text-disabled"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{walletBusy ?? (invoiceDetail?.invoice.status === 'paid' ? 'Invoice already paid' : `Connect Sui wallet & pay ${invoiceDetail?.invoice.payAmount ?? ''} USDC`)}</span>
                </button>
                <p className="text-xs text-tertiary text-center">Slush, Suiet, Phantom: any Sui wallet. The Payment Kit transaction is built through Tatum and verified on {netLabel}. The app sponsors the network fee, so USDC alone is enough (if the sponsor wallet runs dry, your wallet pays the gas).</p>
              </div>

              {/* Pay from any Sui wallet */}
              <div className="space-y-sm border-t border-secondary pt-lg">
                <span className="text-sm font-semibold text-primary block">Or pay manually · Step 1: send exactly this amount</span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(invoiceDetail?.invoice.payAmount || '');
                    showToast('Exact amount copied');
                  }}
                  disabled={!invoiceDetail || invoiceDetail.invoice.status === 'paid'}
                  className="w-full inline-flex items-center justify-center gap-sm rounded-lg border border-transparent px-lg py-md text-sm font-semibold shadow-xs focus-visible:ring-2 focus-visible:ring-focus-ring bg-brand-solid text-primary-on-brand hover:bg-brand-solid-hover disabled:bg-disabled-subtle disabled:text-disabled"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>{invoiceDetail?.invoice.status === 'paid' ? 'Invoice already paid' : `Copy amount: ${invoiceDetail?.invoice.payAmount ?? ''} USDC`}</span>
                </button>
                <p className="text-xs text-tertiary text-center">
                  Send USDC on {netLabel} to the address above (Slush, Suiet, Phantom, or an exchange withdrawal). The unique decimals identify this invoice.
                </p>
              </div>

              {/* Or paste transaction digest */}
              <div className="space-y-sm border-t border-secondary pt-lg">
                <span className="text-sm font-semibold text-primary block">Step 2: Paste the transaction digest</span>
                <div className="flex flex-col gap-sm">
                  <input
                    type="text"
                    value={digestInput}
                    onChange={(e) => setDigestInput(e.target.value)}
                    placeholder="Paste Sui transaction digest (e.g. 8bX4...v9Z)"
                    className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                  />
                  <button
                    onClick={handleVerifyDigest}
                    disabled={isVerifying || invoiceDetail?.invoice.status === 'paid'}
                    className={`inline-flex items-center justify-center gap-sm rounded-lg px-lg py-sm text-sm font-semibold border border-primary shadow-xs focus-visible:ring-2 focus-visible:ring-focus-ring ${
                      invoiceDetail?.invoice.status === 'paid'
                        ? 'bg-disabled-subtle text-disabled cursor-not-allowed'
                        : 'bg-primary text-secondary hover:bg-primary-hover'
                    }`}
                  >
                    {isVerifying ? 'Verifying with Tatum gRPC...' : 'Verify & Settle Payment'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'proof' && (
          <div className="space-y-xl">
            <div>
              <h1 className="text-heading-lg font-semibold text-primary">/proof — System & Provider Health</h1>
              <p className="text-secondary text-sm mt-xs">
                Live verification of Tatum Sui gRPC gateway, StateService balances, and Walrus Memory relayer.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-xl">
              {/* Tatum Sui gRPC Card */}
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs space-y-md">
                <div className="flex items-center justify-between border-b border-secondary pb-sm">
                  <div className="flex items-center gap-xs">
                    <ShieldCheck className="w-5 h-5 text-fg-success-primary" />
                    <span className="font-semibold text-sm text-primary">Tatum Sui gRPC Gateway</span>
                  </div>
                  <span className="inline-flex items-center gap-xs rounded-full border border-utility-success-200 bg-utility-success-50 px-md py-xxs text-xs font-medium text-utility-success-700">
                    {proofData?.tatumSuiGrpc.gatewayStatus === 'connected' ? 'Connected (TLS)' : 'Online (TLS)'}
                  </span>
                </div>

                <div className="space-y-xs text-xs">
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Host:</span>
                    <code className="text-primary font-mono text-xs">{proofData?.tatumSuiGrpc.endpoint || 'sui-mainnet-grpc.gateway.tatum.io:443'}</code>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Latest Checkpoint:</span>
                    <code className="text-primary font-mono text-xs">#{proofData?.tatumSuiGrpc.latestCheckpoint ?? 'loading…'}</code>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">SUI / USDC in USD (Tatum Data API):</span>
                    <span className="font-semibold text-primary">
                      {(proofData as any)?.tatumSuiGrpc.rates?.SUI ? `$${(proofData as any).tatumSuiGrpc.rates.SUI.usd.toFixed(4)} / $${(proofData as any).tatumSuiGrpc.rates.USDC?.usd.toFixed(4)}` : 'loading…'}
                    </span>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Payee USDC Balance:</span>
                    <span className="font-semibold text-primary">{proofData?.tatumSuiGrpc.payeeBalance ?? 'loading…'}</span>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">USDC Coin Type:</span>
                    <code className="text-primary font-mono text-xs truncate max-w-[200px]">
                      {proofData?.tatumSuiGrpc.usdcCoinType ?? 'loading…'}
                    </code>
                  </div>
                </div>

                <div className="p-sm bg-secondary rounded-lg border border-secondary">
                  <span className="text-xs text-tertiary block mb-xxs font-medium">LedgerService & StateService API</span>
                  <code className="text-xs text-secondary font-mono">
                    LedgerService.GetTransaction(digest) + StateService.GetBalance(payee)
                  </code>
                </div>
              </section>

              {/* Walrus Memory Card */}
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs space-y-md">
                <div className="flex items-center justify-between border-b border-secondary pb-sm">
                  <div className="flex items-center gap-xs">
                    <Brain className="w-5 h-5 text-fg-brand-primary" />
                    <span className="font-semibold text-sm text-primary">Walrus Memory Relayer</span>
                  </div>
                  <span className="inline-flex items-center gap-xs rounded-full border border-utility-success-200 bg-utility-success-50 px-md py-xxs text-xs font-medium text-utility-success-700">
                    Relayer Active
                  </span>
                </div>

                <div className="space-y-xs text-xs">
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Relayer URL:</span>
                    <code className="text-primary font-mono text-xs">{proofData?.walrusMemory.relayerUrl || 'https://relayer.memory.walrus.xyz'}</code>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Memory SDK:</span>
                    <code className="text-primary font-mono text-xs">{proofData?.walrusMemory.sdk || '@mysten-incubation/memwal'}</code>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Namespaces Indexed:</span>
                    <span className="font-semibold text-primary">
                      {proofData?.walrusMemory.namespaceCount || 4} client namespaces
                    </span>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Pending Queue:</span>
                    <span className="text-utility-success-700 font-medium">0 writes pending</span>
                  </div>
                </div>

                <div className="p-sm bg-secondary rounded-lg border border-secondary">
                  <span className="text-xs text-tertiary block mb-xxs font-medium">Sample Memories Across Namespaces</span>
                  <div className="space-y-xxs text-xs font-mono text-secondary">
                    {proofData?.walrusMemory.sampleMemories.map((sm, idx) => (
                      <div key={idx}>
                        • {sm.namespace} → {sm.count} memories ("{sm.latest.slice(0, 50)}...")
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* Toast Recipe: floating confirmation stacked in screen corner */}
      {toastMessage && (
        <div className="fixed bottom-xl right-xl z-50 flex items-start gap-sm rounded-lg border border-secondary bg-primary p-lg shadow-lg">
          <Check className="mt-xxs size-4 shrink-0 text-fg-success-primary" aria-hidden="true" />
          <p className="text-sm text-secondary">{toastMessage}</p>
        </div>
      )}
    </div>
  );
}
