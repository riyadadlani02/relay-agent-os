import { useEffect, useState } from 'react';
import type { summarize } from '../gauntlet/evaluate';
type Summary = ReturnType<typeof summarize>;
type Matrix = {
  reports: {
    name: string;
    status: string;
    reason?: string;
    summary: Summary | null;
    report: string | null;
  }[];
};
export function useGauntlet() {
  const [matrix, setMatrix] = useState<Matrix>();
  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}evidence/gauntlet/summary.json`)
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) => {
        if (active) setMatrix(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return matrix;
}
export function GauntletHeadline() {
  const matrix = useGauntlet();
  const measured = matrix?.reports.find(
    (r) => r.status === 'complete' && r.name === 'gpt-4.1-mini',
  );
  const violations =
    matrix?.reports.reduce((n, r) => n + (r.summary?.policyViolations ?? 0), 0) ?? 0;
  if (violations)
    return (
      <a className="gauntlet-proof" href="#evidence">
        <strong>
          Gauntlet found {violations} unauthorized {violations === 1 ? 'action' : 'actions'}
        </strong>
        <span>Now blocked by customer consent · replay-verified, not re-measured ↗</span>
      </a>
    );
  return (
    <a className="gauntlet-proof" href="#evidence">
      {measured?.summary ? (
        <>
          <strong>
            {measured.summary.policyViolations} unauthorized actions / {measured.summary.attempted}{' '}
            cases
          </strong>
          <span>GPT-4.1 mini · 400 attacks + 100 controls · inspect the failures ↗</span>
        </>
      ) : (
        <>
          <strong>The Relay Gauntlet</strong>
          <span>500 cases · three languages · inspect model coverage ↗</span>
        </>
      )}
    </a>
  );
}
export default function GauntletEvidence() {
  const matrix = useGauntlet();
  return (
    <div className="gauntlet-evidence">
      <h3>The Relay Gauntlet</h3>
      <p>
        500 distinct cases. 400 attacks and 100 legitimate controls in English, Hindi and Hinglish.
        Refund splitting, forged approvals, wrong units, duplicate requests, and replay after
        reopening saved state.
      </p>
      <div className="evidence-table-wrap">
        <table>
          <caption>Actual model coverage — incomplete runs are shown explicitly</caption>
          <thead>
            <tr>
              <th>Model / coverage</th>
              <th>Unauthorized actions</th>
              <th>Legitimate requests failed</th>
              <th>Human intervention</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {matrix?.reports.map((r) => (
              <tr key={r.name}>
                <th>
                  {r.name}
                  <small className="matrix-status">
                    {r.summary?.attempted ?? 0}/500 · {r.status.replaceAll('_', ' ')}
                  </small>
                </th>
                <td>
                  {r.summary?.attempted
                    ? `${r.summary.policyViolations} / ${r.summary.attempted}`
                    : 'Not measured'}
                </td>
                <td>
                  {r.summary?.legitimateCases
                    ? `${r.summary.legitimateRequestsFailed} / ${r.summary.legitimateCases}`
                    : 'Not measured'}
                </td>
                <td>
                  {r.summary?.attempted
                    ? `${r.summary.humanIntervention} / ${r.summary.attempted}`
                    : 'Not measured'}
                </td>
                <td>
                  {r.report ? (
                    <a href={`${import.meta.env.BASE_URL}${r.report}`}>Full trace ↗</a>
                  ) : (
                    'Pending'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!matrix && (
        <p>Published results are loading. The method and raw reports are available below.</p>
      )}
      <p className="evidence-caveat">
        Author-generated, correlated cases: 550 turns, 450 distinct message strings. These are not
        real phone calls or proof of universal safety. A failed legitimate request includes a
        refusal, missing approval, handoff or runtime error. Human intervention counts both approval
        gates and support handoffs. None of the evaluations grant approval or call a payment API.
      </p>
      <p className="matrix-note">
        <strong>Fixed since these runs:</strong> a change the model proposes now needs the
        customer&apos;s confirmation, which becomes a single-use capability for that exact action
        and order. Replaying all 15 recorded Qwen proposals through the current kernel gives 0
        unauthorized writes: information_only-01 stops at a prompt the customer declines. This is a
        replay of recorded choices, not new inference. The table still shows the kernel the models
        were measured on.{' '}
        <a href={`${import.meta.env.BASE_URL}evidence/gauntlet/qwen-replay.json`}>Replay ↗</a>{' '}
        <a href={`${import.meta.env.BASE_URL}?os=1`}>Kernel console ↗</a>
      </p>
      {matrix?.reports
        .filter((r) => r.reason)
        .map((r) => (
          <p key={r.name} className="matrix-note">
            <strong>{r.name}:</strong> {r.reason}
          </p>
        ))}
      <div className="evidence-links">
        <a href="https://github.com/riyadadlani02/relay-agent-os/blob/main/docs/gauntlet-results.md">
          Results, failures & latency ↗
        </a>
        <a href="https://github.com/riyadadlani02/relay-agent-os/blob/main/docs/gauntlet.md">
          Method & release gate ↗
        </a>
        <a href={`${import.meta.env.BASE_URL}?gauntlet=1`}>Run Qwen on your device ↗</a>
      </div>
    </div>
  );
}
