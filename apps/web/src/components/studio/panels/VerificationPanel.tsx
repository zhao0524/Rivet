import type { BuildPlan, FindingResult } from "./types";
import { isBlocking, isSyntheticPlan, PLAN_STATUS_LABEL, RESULT_ORDER, usableUrl } from "./helpers";

export interface VerificationPanelProps {
  plan: BuildPlan;
  onSelectInstance?: (instanceId: string) => void;
}

const RESULT_LABEL: Record<FindingResult, string> = {
  PASS: "PASS",
  WARN: "WARN",
  FAIL: "FAIL",
  UNKNOWN: "UNKNOWN",
};

export function VerificationPanel({ plan, onSelectInstance }: VerificationPanelProps) {
  const { overall, findings } = plan.verification;
  const sorted = [...findings].sort(
    (a, b) =>
      Number(isBlocking(b)) - Number(isBlocking(a)) || RESULT_ORDER.indexOf(a.result) - RESULT_ORDER.indexOf(b.result),
  );
  const blocking = findings.filter(isBlocking);
  const synthetic = isSyntheticPlan(plan);
  const counts = RESULT_ORDER.map((r) => [r, findings.filter((f) => f.result === r).length] as const);

  return (
    <section aria-label="Verification" data-testid="verification-panel" className="rivet-panel">
      <h2>Verification</h2>
      <p data-testid="verification-overall" data-status={overall}>
        Status: <strong>{PLAN_STATUS_LABEL[overall]}</strong>
      </p>
      {(overall === "verified" || overall === "verified_with_warnings") && (
        <p role="note" data-testid="verification-scope-note">
          Verified means the implemented automated checks passed. It is not a real-world safety certification.
        </p>
      )}
      {synthetic && (
        <p role="note" data-testid="verification-synthetic-notice">
          Generated in <code>{plan.provenance.generation_mode}</code> mode. These results do not describe verified
          physical hardware.
        </p>
      )}
      <ul aria-label="Finding counts" data-testid="verification-counts">
        {counts.map(([r, n]) => (
          <li key={r} data-testid={`verification-count-${r}`}>
            {RESULT_LABEL[r]}: {n}
          </li>
        ))}
      </ul>
      {blocking.length > 0 && (
        <p role="alert" data-testid="verification-blocking-summary">
          {blocking.length} blocking finding{blocking.length === 1 ? "" : "s"} unresolved
        </p>
      )}
      {sorted.length === 0 ? (
        <p data-testid="verification-empty">No findings reported.</p>
      ) : (
        <ul aria-label="Findings">
          {sorted.map((f, idx) => (
            <li
              key={`${f.rule_id}-${idx}`}
              data-testid={`finding-${f.rule_id}`}
              data-result={f.result}
              data-severity={f.severity}
              data-blocking={isBlocking(f) ? "true" : "false"}
            >
              <p>
                <strong data-testid={`finding-result-${f.rule_id}`}>{RESULT_LABEL[f.result]}</strong> ·{" "}
                {isBlocking(f) ? "Blocking" : f.severity} · <code>{f.rule_id}</code>
              </p>
              <p>{f.message}</p>
              {f.affected_instance_ids.length > 0 && (
                <ul aria-label={`Parts affected by ${f.rule_id}`}>
                  {f.affected_instance_ids.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => onSelectInstance?.(id)}
                        disabled={!onSelectInstance}
                        data-testid={`finding-${f.rule_id}-instance-${id}`}
                      >
                        {id}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {f.evidence_urls.length > 0 ? (
                <ul aria-label={`Evidence for ${f.rule_id}`}>
                  {f.evidence_urls.map((u) => {
                    const href = usableUrl(u);
                    return <li key={u}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{href}</a> : u}</li>;
                  })}
                </ul>
              ) : (
                <p data-testid={`finding-no-evidence-${f.rule_id}`}>No evidence links provided.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
