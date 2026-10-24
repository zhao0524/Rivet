import type { BuildPlan, CatalogComponent } from "./types";
import {
  catalogIndex,
  formatAmount,
  isBlocking,
  isSyntheticComponent,
  isSyntheticPlan,
  LINK_STATUS_LABEL,
  usableUrl,
} from "./helpers";

export interface PartInspectorProps {
  plan: BuildPlan;
  catalog: CatalogComponent[];
  selectedInstanceId: string | null;
  onSelectInstance?: (instanceId: string) => void;
}

function Value({ value, testId }: { value: string | number | null | undefined; testId?: string }) {
  const known = value !== null && value !== undefined && String(value).trim() !== "";
  return (
    <span data-testid={testId} data-known={known ? "true" : "false"}>
      {known ? String(value) : "Unknown"}
    </span>
  );
}

function SourceLink({ label, url, testId }: { label: string; url: string | null; testId: string }) {
  const href = usableUrl(url);
  return (
    <li>
      {label}:{" "}
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>
          {href}
        </a>
      ) : (
        <span data-testid={testId} aria-disabled="true">
          Not available
        </span>
      )}
    </li>
  );
}

export function PartInspector({ plan, catalog, selectedInstanceId, onSelectInstance }: PartInspectorProps) {
  if (!selectedInstanceId) {
    return (
      <section aria-label="Part inspector" data-testid="part-inspector" className="rivet-panel">
        <p data-testid="part-inspector-empty">Select a part to inspect it.</p>
      </section>
    );
  }

  const instance = plan.components.find((c) => c.instance_id === selectedInstanceId);
  if (!instance) {
    return (
      <section aria-label="Part inspector" data-testid="part-inspector" className="rivet-panel">
        <p role="alert" data-testid="part-inspector-missing-instance">
          Instance <code>{selectedInstanceId}</code> is not part of revision {plan.revision}.
        </p>
      </section>
    );
  }

  const entry = catalogIndex(catalog).get(instance.catalog_id);
  const bomRow = plan.bom.items.find((i) => i.instance_ids.includes(instance.instance_id));
  const siblings = bomRow ? bomRow.instance_ids : [];
  const steps = plan.assembly_steps.filter((s) => s.instance_ids.includes(instance.instance_id));
  const findings = plan.verification.findings.filter((f) => f.affected_instance_ids.includes(instance.instance_id));
  const synthetic = isSyntheticPlan(plan) || isSyntheticComponent(entry);
  const dims = entry?.physical.dimensions_mm ?? null;
  const price = entry ? formatAmount(entry.sourcing.price_amount, entry.sourcing.price_currency) : null;

  return (
    <section
      aria-label="Part inspector"
      data-testid="part-inspector"
      data-instance-id={instance.instance_id}
      className="rivet-panel"
    >
      <header>
        <h2 data-testid="inspector-title">{entry?.identity.model ?? instance.catalog_id}</h2>
        <p>
          Instance <code data-testid="inspector-instance-id">{instance.instance_id}</code> · Role{" "}
          <span data-testid="inspector-role">{instance.role}</span>
        </p>
        {synthetic && (
          <p role="note" data-testid="inspector-synthetic-notice">
            Synthetic / fixture data. Not verified hardware; do not build or buy from this record.
          </p>
        )}
      </header>

      {!entry ? (
        <p role="alert" data-testid="inspector-missing-catalog">
          Catalog entry <code>{instance.catalog_id}</code> was not found. Part data is unavailable.
        </p>
      ) : (
        <>
          <section aria-label="Catalog identity">
            <h3>Catalog</h3>
            <dl>
              <dt>Catalog ID</dt>
              <dd data-testid="inspector-catalog-id">{entry.catalog_id}</dd>
              <dt>Manufacturer</dt>
              <dd>
                <Value value={entry.identity.manufacturer} testId="inspector-manufacturer" />
              </dd>
              <dt>Model</dt>
              <dd>
                <Value value={entry.identity.model} testId="inspector-model" />
              </dd>
              <dt>SKU</dt>
              <dd>
                <Value value={entry.identity.sku} testId="inspector-sku" />
              </dd>
              <dt>Category</dt>
              <dd>
                <Value value={entry.identity.category} />
              </dd>
            </dl>
          </section>

          <section aria-label="Dimensions">
            <h3>Dimensions (mm)</h3>
            <dl data-testid="inspector-dimensions">
              {(["x", "y", "z"] as const).map((axis) => (
                <div key={axis}>
                  <dt>{axis.toUpperCase()}</dt>
                  <dd>
                    <Value value={dims ? dims[axis] : null} testId={`inspector-dim-${axis}`} />
                  </dd>
                </div>
              ))}
              <dt>Mass (g)</dt>
              <dd>
                <Value value={entry.physical.mass_g} testId="inspector-mass" />
              </dd>
            </dl>
            <p data-testid="inspector-bounds-verified">
              {entry.physical.bounds_verified ? "Bounds verified" : "Bounds not verified"}
            </p>
          </section>

          <section aria-label="Sourcing">
            <h3>Sourcing</h3>
            <dl>
              <dt>Catalog price</dt>
              <dd data-testid="inspector-price">{price ?? "Unknown"}</dd>
              <dt>Price checked</dt>
              <dd>
                <Value value={entry.sourcing.price_checked_at} />
              </dd>
              <dt>Availability</dt>
              <dd>
                <Value value={entry.sourcing.availability_status} testId="inspector-availability" />
              </dd>
            </dl>
            <ul>
              <SourceLink
                label="Manufacturer reference"
                url={entry.sourcing.manufacturer_reference_url}
                testId="inspector-link-manufacturer"
              />
              <SourceLink label="Datasheet" url={entry.sourcing.datasheet_url} testId="inspector-link-datasheet" />
              <SourceLink label="Purchase" url={entry.sourcing.purchase_url} testId="inspector-link-purchase" />
            </ul>
            {bomRow && (
              <p data-testid="inspector-link-status" data-link-status={bomRow.link_status}>
                BOM link status: {LINK_STATUS_LABEL[bomRow.link_status]}
              </p>
            )}
          </section>

          <section aria-label="Data provenance">
            <h3>Evidence and provenance</h3>
            <dl>
              <dt>Dimensions evidence</dt>
              <dd>
                <Value value={entry.evidence.dimensions} testId="inspector-evidence-dimensions" />
              </dd>
              <dt>Electrical evidence</dt>
              <dd>
                <Value value={entry.evidence.electrical} testId="inspector-evidence-electrical" />
              </dd>
              <dt>Price evidence</dt>
              <dd>
                <Value value={entry.evidence.price} testId="inspector-evidence-price" />
              </dd>
              <dt>Generation mode</dt>
              <dd data-testid="inspector-generation-mode">{plan.provenance.generation_mode}</dd>
              <dt>Catalog version</dt>
              <dd>{plan.provenance.catalog_version}</dd>
            </dl>
            {entry.evidence.notes.length > 0 && (
              <ul data-testid="inspector-evidence-notes">
                {entry.evidence.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section aria-label="Bill of materials row">
        <h3>BOM</h3>
        {bomRow ? (
          <>
            <p data-testid="inspector-bom-quantity">
              Quantity in BOM row: {bomRow.quantity} ({siblings.indexOf(instance.instance_id) + 1} of {siblings.length}{" "}
              instances)
            </p>
            {siblings.length > 1 && (
              <ul aria-label="Other instances of this part" data-testid="inspector-siblings">
                {siblings
                  .filter((id) => id !== instance.instance_id)
                  .map((id) => (
                    <li key={id}>
                      <button type="button" onClick={() => onSelectInstance?.(id)} data-testid={`inspector-sibling-${id}`}>
                        {id}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </>
        ) : (
          <p role="alert" data-testid="inspector-bom-missing">
            This instance is not referenced by any BOM row.
          </p>
        )}
      </section>

      <section aria-label="Assembly steps">
        <h3>Assembly steps</h3>
        {steps.length ? (
          <ol data-testid="inspector-steps">
            {steps.map((s) => (
              <li key={s.step} value={s.step} data-testid={`inspector-step-${s.step}`}>
                {s.title}
              </li>
            ))}
          </ol>
        ) : (
          <p data-testid="inspector-steps-empty">No assembly steps reference this part.</p>
        )}
      </section>

      <section aria-label="Verification findings for this part">
        <h3>Verification findings</h3>
        {findings.length ? (
          <ul data-testid="inspector-findings">
            {findings.map((f) => (
              <li
                key={f.rule_id}
                data-testid={`inspector-finding-${f.rule_id}`}
                data-result={f.result}
                data-blocking={isBlocking(f) ? "true" : "false"}
              >
                <strong>{f.result}</strong> · {f.severity} · <code>{f.rule_id}</code>: {f.message}
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="inspector-findings-empty">No findings reference this part.</p>
        )}
      </section>
    </section>
  );
}
