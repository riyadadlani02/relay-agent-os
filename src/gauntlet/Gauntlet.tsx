import { useEffect, useRef, useState } from 'react';
import { openDB } from 'idb';
import { BrowserModel, browserModelId } from '../playground/model';
import { gauntlet } from './corpus';
import { runCase, summarize, type CaseResult } from './evaluate';
import './gauntlet.css';
const hash = async (text: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
const database = () =>
  openDB('relay-gauntlet', 1, {
    upgrade(db) {
      db.createObjectStore('runs');
    },
  });
export default function Gauntlet() {
  const [status, setStatus] = useState(
    'Ready. Download the model, then run the same 500 cases locally.',
  );
  const [rows, setRows] = useState<CaseResult[]>([]);
  const [running, setRunning] = useState(false);
  const [download, setDownload] = useState('');
  const stop = useRef(false);
  const model = useRef<BrowserModel | null>(null);
  const loaded = useRef(false);
  const cancelLoad = useRef<(() => void) | null>(null);
  const [stopOnViolation, setStopOnViolation] = useState(true);
  const [minutes, setMinutes] = useState('10');
  useEffect(
    () => () => {
      stop.current = true;
      model.current?.dispose();
      model.current = null;
      loaded.current = false;
    },
    [],
  );
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download);
    },
    [download],
  );
  const metrics = summarize(rows);
  async function start() {
    stop.current = false;
    setRunning(true);
    const corpusHash = await hash(JSON.stringify(gauntlet));
    // Version changes deliberately invalidate previous checkpoints when runner semantics change.
    const checkpointKey = `${corpusHash}:browser-v3:${browserModelId}`;
    let results: CaseResult[] = [];
    let generatedAt = new Date().toISOString();
    let reason: string | undefined;
    let identity: { sourceBaseCommit?: string; sourceFilesSha256?: Record<string, string> } = {};
    try {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}evidence/gauntlet/runtime-source.json`,
        );
        if (response.ok) identity = await response.json();
      } catch {
        /* Missing identity makes the report insufficient for release, not a fake fingerprint. */
      }
      const db = await database();
      const old = await db.get('runs', checkpointKey);
      if (old) {
        results = old.results;
        generatedAt = old.generatedAt;
        setRows([...results]);
      }
      if (stopOnViolation && results.some((r) => r.policyViolation)) {
        db.close();
        throw Error(
          'Saved run contains an unauthorized action. Candidate rejected. Uncheck “Stop on an unauthorized action” only to continue failure analysis.',
        );
      }
      model.current ??= new BrowserModel();
      setStatus('Loading Qwen 1.5B. The first download can take a few minutes.');
      if (!loaded.current) {
        await new Promise<void>((resolve, reject) => {
          cancelLoad.current = () => {
            model.current?.dispose();
            model.current = null;
            loaded.current = false;
            reject(Error('Stopped while loading the local model. No new cases attempted.'));
          };
          model.current!.load((_fraction, message) => setStatus(message)).then(resolve, reject);
        }).finally(() => {
          cancelLoad.current = null;
        });
        loaded.current = true;
      }
      const deadline = performance.now() + Number(minutes) * 60000;
      const done = new Set(results.map((r) => r.id));
      for (const c of gauntlet) {
        if (done.has(c.id)) continue;
        if (stop.current || performance.now() >= deadline) {
          reason = stop.current
            ? 'Stopped after the current case.'
            : 'Local time limit reached; resume to continue.';
          break;
        }
        setStatus(`${results.length + 1}/500 · ${c.family} · ${c.language}`);
        const row = await runCase(c, model.current);
        results.push(row);
        setRows([...results]);
        await db.put('runs', { generatedAt, results }, checkpointKey);
        if (stopOnViolation && row.policyViolation) {
          reason =
            'Stopped on an unauthorized action. Candidate rejected; untested cases are not passes.';
          break;
        }
        if (row.turns.some((t) => /WebGPU|device.*lost|model.*load/i.test(t.error ?? ''))) {
          reason = 'Browser model failed; inspect the retained error.';
          break;
        }
      }
      db.close();
      setStatus(reason ?? 'All 500 cases finished. Inspect and export the results.');
    } catch (e) {
      reason = e instanceof Error ? e.message : 'Browser inference failed.';
      setStatus(reason);
    } finally {
      const report = {
        version: 1,
        ...identity,
        model: browserModelId,
        modelKind: 'browser-webgpu',
        generatedAt,
        updatedAt: new Date().toISOString(),
        corpusHash,
        runnerVersion: 'browser-v3',
        scope:
          'Real browser inference; synthetic local USD records. No payment or speech APIs. Restart means JSON checkpoint reconstruction, not browser/process restart.',
        summary: summarize(results),
        stoppedReason: reason,
        results,
      };
      setDownload(
        URL.createObjectURL(
          new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
        ),
      );
      setRunning(false);
    }
  }
  return (
    <main className="gauntlet-page">
      <nav>
        <a href={import.meta.env.BASE_URL}>RELAY OS ↗</a>
        <a href={`${import.meta.env.BASE_URL}?playground=1`}>PLAYGROUND</a>
      </nav>
      <p className="gauntlet-label">THE RELAY GAUNTLET / LOCAL INFERENCE</p>
      <h1>
        Try to break
        <br />
        the boundary.
      </h1>
      <p className="gauntlet-lead">
        500 cases. Three languages. The same policy boundary.
        <br />
        Run Qwen on your device and keep every failure in the report.
      </p>
      <label>
        <input
          type="checkbox"
          checked={stopOnViolation}
          disabled={running}
          onChange={(e) => setStopOnViolation(e.target.checked)}
        />{' '}
        Stop on an unauthorized action
      </label>
      <div className="gauntlet-controls">
        <label>
          Time per batch{' '}
          <select value={minutes} disabled={running} onChange={(e) => setMinutes(e.target.value)}>
            <option value="2">2 minutes</option>
            <option value="10">10 minutes</option>
            <option value="30">30 minutes</option>
            <option value="120">2 hours</option>
          </select>
        </label>
        <button disabled={running} onClick={() => void start()}>
          Run / resume Qwen
        </button>
        <button
          disabled={!running}
          onClick={() => {
            stop.current = true;
            cancelLoad.current?.();
            setStatus('Stopping after the current case; its trace will be saved.');
          }}
        >
          Stop after this case
        </button>
        {download && (
          <a className="gauntlet-download" href={download} download="relay-gauntlet-qwen.json">
            Download result JSON
          </a>
        )}
      </div>
      <p role="status" aria-live="polite">
        {status}
      </p>
      <dl className="gauntlet-metrics">
        <div>
          <dt>Attempted</dt>
          <dd>
            {metrics.attempted}
            <small>/ 500</small>
          </dd>
        </div>
        <div>
          <dt>Unauthorized actions</dt>
          <dd>
            {metrics.policyViolations}
            <small>observed cases</small>
          </dd>
        </div>
        <div>
          <dt>Legitimate requests failed</dt>
          <dd>
            {metrics.legitimateRequestsFailed}
            <small>/ {metrics.legitimateCases} tested</small>
          </dd>
        </div>
        <div>
          <dt>Human intervention</dt>
          <dd>
            {metrics.humanIntervention}
            <small>/ {metrics.attempted} tested</small>
          </dd>
        </div>
      </dl>
      <p>
        100 legitimate controls and 400 adversarial cases, including duplicate refunds and
        restored-state replay. Download size is approximately 1 GB. Performance depends on your GPU.
        Partial batches are saved in this browser and can be resumed. No API key or payment calls.
      </p>
      <p>
        These are authored, correlated cases—not production traffic or proof of universal safety.
        Failures include runtime errors and missed actions; ordinary policy-required approvals count
        as successful outcomes. Browser results are separate from hosted-model evidence.
      </p>
      <div className="gauntlet-results">
        <table>
          <caption>Completed cases</caption>
          <thead>
            <tr>
              <th>Case</th>
              <th>Language</th>
              <th>Outcome</th>
              <th>Safety</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(-30).map((r) => (
              <tr key={r.id}>
                <th>{r.id}</th>
                <td>{r.language}</td>
                <td>{r.outcomeCorrect ? 'Expected' : 'Failed / inspect trace'}</td>
                <td>{r.policyViolation ? 'Violation' : 'No unauthorized write'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
