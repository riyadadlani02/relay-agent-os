import { useEffect, useState } from 'react';
import '../playground/playground.css';
import '@fontsource/anton/latin-400.css';
import '@fontsource/space-mono/latin-400.css';
import type { Binding, Intent } from '../../server/connectors/payment-service';
declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void };
  }
}
export default function Payments() {
  const [state, setState] = useState<{ bindings: Binding[]; intents: Intent[]; audit: unknown[] }>({
    bindings: [],
    intents: [],
    audit: [],
  });
  const [config, setConfig] = useState<{ enabled: boolean; keyId: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [request, setRequest] = useState('Please refund order R-2000.');
  async function refresh() {
    setState(await (await fetch('/api/payments/state')).json());
  }
  useEffect(() => {
    void refresh();
    fetch('/api/payments/config')
      .then((r) => r.json())
      .then(setConfig);
  }, []);
  async function action(name: string, id?: string) {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch(`/api/payments/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(id ? { id } : {}), ...(name === 'propose' ? { request } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(
        d.model
          ? `Proposal from ${d.model}. ${d.plan.reply}`
          : name === 'fixture'
            ? 'Test order created. Complete checkout with a Razorpay test card.'
            : 'State verified. Inspect the audit below.',
      );
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function checkout(b: Binding) {
    try {
      if (!window.Razorpay)
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://checkout.razorpay.com/v1/checkout.js';
          s.onload = () => resolve();
          s.onerror = () => reject(Error('Checkout could not load.'));
          document.head.appendChild(s);
        });
      new window.Razorpay({
        key: config?.keyId,
        order_id: b.providerOrderId,
        amount: b.amount,
        currency: 'INR',
        name: 'Relay OS test fixture',
        description: 'Synthetic test payment. No real money.',
        handler: () => void action('sync', b.id),
        theme: { color: '#52623e' },
      }).open();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <div className="live-app">
      <header className="live-header">
        <a className="live-brand" href="/">
          RELAY OS
        </a>
        <a href="/?playground=1">AI playground</a>
      </header>
      <main style={{ maxWidth: 1100, margin: 'auto', padding: 30 }}>
        <h1 style={{ fontFamily: 'Anton', fontSize: 48 }}>A payment with a paper trail.</h1>
        <p>Razorpay test mode · INR only · local server · synthetic customer data.</p>
        <p>
          Each test order is ₹49.00 (4,900 paise). The planner can propose a refund; an operator
          must approve the exact amount and payment. No live keys are accepted.
        </p>
        <button
          className="live-primary"
          disabled={busy || !config?.enabled}
          onClick={() => void action('fixture')}
        >
          Create ₹49 test order
        </button>
        {config && !config.enabled && (
          <p>
            Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET with test credentials in the server’s
            .env file.
          </p>
        )}
        <p role="status">{message}</p>
        <label htmlFor="payment-request">Customer request</label>
        <textarea
          id="payment-request"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          style={{ display: 'block', width: '100%', padding: 14, margin: '10px 0 25px' }}
        />
        {state.bindings.map((b) => (
          <section
            key={b.id}
            style={{ border: '1px solid #747e63', padding: 20, marginBottom: 18 }}
          >
            <h2>
              {b.id} · ₹{(b.amount / 100).toFixed(2)}
            </h2>
            <p>Provider order: {b.providerOrderId}</p>
            <p>Verified payment: {b.paymentId ?? 'Awaiting test checkout'}</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {!b.paymentId && (
                <button className="live-primary" onClick={() => void checkout(b)}>
                  Open test checkout
                </button>
              )}
              <button
                className="live-quiet"
                disabled={busy}
                onClick={() => void action('sync', b.id)}
              >
                Verify captured payment
              </button>
              <button
                className="live-primary"
                disabled={busy || !b.paymentId}
                onClick={() => void action('propose', b.id)}
              >
                Ask agent to prepare refund
              </button>
            </div>
          </section>
        ))}
        {state.intents.map((i) => (
          <section key={i.id} className="live-approval">
            <h2>Refund readback · {i.status}</h2>
            <p>
              ₹{(i.amount / 100).toFixed(2)} INR → payment {i.paymentId} for order {i.bindingId}
            </p>
            <p>Stable request key: {i.id}</p>
            {i.refundId && <p>Provider refund: {i.refundId}</p>}
            {i.status === 'awaiting_approval' ? (
              <div className="approval-buttons">
                <button
                  className="live-primary"
                  disabled={busy}
                  onClick={() => void action('approve', i.id)}
                >
                  Approve ₹{(i.amount / 100).toFixed(2)} test refund
                </button>
                <button
                  className="live-quiet"
                  disabled={busy}
                  onClick={() => void action('reject', i.id)}
                >
                  Reject
                </button>
              </div>
            ) : (
              ['unknown', 'sending', 'pending'].includes(i.status) && (
                <button
                  className="live-primary"
                  disabled={busy}
                  onClick={() => void action('retry', i.id)}
                >
                  Reconcile same refund intent
                </button>
              )
            )}
          </section>
        ))}
        <h2>Audit trail</h2>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>
          {JSON.stringify(state.audit, null, 2)}
        </pre>
      </main>
    </div>
  );
}
