import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import GauntletEvidence from './GauntletEvidence';
type Summary = {
  generatedAt: string;
  model: string;
  uniqueRequests: number;
  count: number;
  policyViolations: number;
  outcomesCorrect: number;
  approvalRequired: number;
  errors: number;
  latency: {
    p50Ms: number;
    p95Ms: number;
    steps: { name: string; count: number; p50Ms: number; p95Ms: number }[];
  };
  families: { family: string; count: number; outcomesCorrect: number; policyViolations: number }[];
};
const repo = 'https://github.com/riyadadlani02/relay-agent-os';
export default function Evidence() {
  const [report, setReport] = useState<Summary>();
  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}evidence/summary.json`)
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((r) => {
        if (active) setReport(r);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <section id="evidence" className="evidence-section" aria-labelledby="evidence-title">
        <div className="evidence-heading">
          <div>
            <p>Evidence you can inspect</p>
            <h2 id="evidence-title">Test the boundary.</h2>
          </div>
          <a href={`${repo}/blob/main/docs/gauntlet.md`}>
            Method, limitations & reproduction <ArrowUpRight size={17} />
          </a>
        </div>
        <GauntletEvidence />
        <details className="evidence-details pilot-evidence">
          <summary>Earlier pilot: 240 runs, 190 distinct requests</summary>
          <p className="evidence-description">
            Real model calls through the playground’s tool loop. English, Hindi and Hinglish
            requests, expired orders, forged tool results, and instructions to ignore the refund
            limit. Each run starts with fresh sample records.
          </p>
          {report ? (
            <>
              <dl className="evidence-metrics">
                <div>
                  <dt>Observed policy violations</dt>
                  <dd>
                    {report.policyViolations}
                    <small> / {report.count} requests</small>
                  </dd>
                </div>
                <div>
                  <dt>Expected action outcome</dt>
                  <dd>
                    {((100 * report.outcomesCorrect) / report.count).toFixed(1)}%
                    <small>
                      {report.outcomesCorrect}/{report.count} matched
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Approval gate reached</dt>
                  <dd>
                    {((100 * report.approvalRequired) / report.count).toFixed(1)}%
                    <small>
                      {report.approvalRequired}/{report.count} requests
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>End-to-end latency</dt>
                  <dd>
                    {(report.latency.p50Ms / 1000).toFixed(1)}s
                    <small>p50 · p95 {(report.latency.p95Ms / 1000).toFixed(1)}s</small>
                  </dd>
                </div>
              </dl>
              <p className="evidence-caveat">
                Measured with {report.model} on{' '}
                {new Date(report.generatedAt).toISOString().slice(0, 10)}. {report.uniqueRequests}{' '}
                distinct strings with repeated template variants; not production traffic or a safety
                guarantee. {report.errors} runtime/provider errors included. Approval rate means
                requests that paused for review; the evaluator approved none.
              </p>
              <details className="evidence-details">
                <summary>See results by request family and step latency</summary>
                <div className="evidence-table-wrap">
                  <table>
                    <caption>Action outcomes by request family</caption>
                    <thead>
                      <tr>
                        <th>Request family</th>
                        <th>Requests</th>
                        <th>Expected outcome</th>
                        <th>Violations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.families.map((f) => (
                        <tr key={f.family}>
                          <th>{f.family.replaceAll('_', ' ')}</th>
                          <td>{f.count}</td>
                          <td>
                            {f.outcomesCorrect}/{f.count}
                          </td>
                          <td>{f.policyViolations}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="evidence-table-wrap">
                  <table>
                    <caption>Observed step latency; no scheduler pacing or human wait</caption>
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>Samples</th>
                        <th>p50 (ms)</th>
                        <th>p95 (ms)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.latency.steps.map((s) => (
                        <tr key={s.name}>
                          <th>{s.name}</th>
                          <td>{s.count}</td>
                          <td>{s.p50Ms}</td>
                          <td>{s.p95Ms}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <p>Read the full evaluation report for the measured results and raw traces.</p>
          )}
          <div className="evidence-links">
            <a href={`${import.meta.env.BASE_URL}evidence/model-eval.json`}>
              Download every model trace <ArrowUpRight size={16} />
            </a>
            <a href={`${import.meta.env.BASE_URL}evidence/frontier.json`}>
              Inspect the GPT-5.4 runs <ArrowUpRight size={16} />
            </a>
            <a href={`${repo}/blob/main/docs/evaluation.md`}>
              Read the evaluation report <ArrowUpRight size={16} />
            </a>
          </div>
          <p className="model-boundary">
            The model is interchangeable. Qwen runs on your device; a hosted model uses the same
            tool contract. Permissions, record amounts, approval gates and final write checks belong
            to the runtime.
          </p>
        </details>
      </section>
      <section id="field-notes" className="field-section" aria-labelledby="field-title">
        <div className="evidence-heading">
          <div>
            <p>From request to rollout</p>
            <h2 id="field-title">Built around the handoff.</h2>
          </div>
          <a href={`${repo}/blob/main/docs/case-study.md`}>
            Read the case study <ArrowUpRight size={17} />
          </a>
        </div>
        <div className="field-grid">
          <article>
            <h3>The customer problem</h3>
            <p>
              A support team needs to resolve routine refunds quickly without giving a model the
              power to invent amounts, bypass a limit, or charge the wrong customer.
            </p>
          </article>
          <article>
            <h3>The constraints</h3>
            <p>
              Retries happen. Connections fail. A caller pauses midway through an order number.
              Every uncertain outcome needs a trace and a safe next step.
            </p>
          </article>
          <article>
            <h3>What stays human</h3>
            <p>
              Refunds above $100, all replacements, identity questions and exceptions. An approval
              does not override the $500 ceiling. Spoken transcripts are reviewed before submission.
            </p>
          </article>
          <article>
            <h3>The rollout</h3>
            <p>
              Start with recorded requests and read-only shadow runs. Review disagreements with
              support staff. Pilot small refunds with daily reconciliation, a kill switch and an
              operator queue.
            </p>
          </article>
        </div>
        <div className="integration-notes">
          <div>
            <h3>Payments bound to trusted records.</h3>
            <p>
              A server-side Razorpay test connector binds payment IDs to trusted records, checks
              integer minor units and currency, persists an idempotent refund intent, and reconciles
              the provider receipt. Test order creation is verified; the real refund cycle is still
              unverified because the provider checkout did not load.
            </p>
            <a href={`${repo}/blob/main/docs/payments.md`}>
              Integration scope & live sandbox evidence <ArrowUpRight size={15} />
            </a>
          </div>
          <div>
            <h3>Voice with an explicit end of turn.</h3>
            <p>
              A Hindi/Hinglish audio path uses Deepgram recognition and explicit end-of-turn
              control. Review the transcript and exact order ID before sending it into the same
              agent runtime. A recorded audio-to-action run is published; no phone line is deployed.
            </p>
            <a href={`${repo}/blob/main/docs/voice.md`}>
              Listen to the sample & inspect the voice trace <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
