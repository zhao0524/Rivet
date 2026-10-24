import type { BuildPlan, BomItem, CatalogComponent } from "./types";
import { catalogIndex, componentIds, formatAmount, LINK_STATUS_LABEL, usableUrl } from "./helpers";

export interface BOMPanelProps {
  plan: BuildPlan;
  catalog: CatalogComponent[];
  selectedInstanceId?: string | null;
  onSelectInstance: (instanceId: string) => void;
}

function PurchaseLink({ item }: { item: BomItem }) {
  const href = usableUrl(item.purchase_url);
  const testId = `bom-link-${item.catalog_id}`;
  if (!href) {
    return (
      <span data-testid={testId} data-link-status={item.link_status} aria-disabled="true">
        No link available
      </span>
    );
  }
  const label =
    item.link_status === "verified_product"
      ? "Product listing"
      : item.link_status === "manufacturer_reference_only"
        ? "Manufacturer reference"
        : "Unverified link";
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId} data-link-status={item.link_status}>
      {label}
    </a>
  );
}

export function BOMPanel({ plan, catalog, selectedInstanceId, onSelectInstance }: BOMPanelProps) {
  const { bom } = plan;
  const byId = catalogIndex(catalog);
  const known = componentIds(plan);
  const anyUnpriced = bom.items.some((i) => formatAmount(i.unit_price_amount, bom.currency) === null);
  const complete = bom.total_status === "complete" && !anyUnpriced;
  const subtotal = formatAmount(bom.known_subtotal_amount, bom.currency);

  return (
    <section aria-label="Bill of materials" data-testid="bom-panel" className="rivet-panel">
      <h2>Bill of materials</h2>
      <p data-testid="bom-row-count">{bom.items.length} line items</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Qty</th>
            <th scope="col">Unit price</th>
            <th scope="col">Link</th>
            <th scope="col">Link status</th>
            <th scope="col">Instances</th>
          </tr>
        </thead>
        <tbody>
          {bom.items.map((item) => {
            const entry = byId.get(item.catalog_id);
            const unitPrice = formatAmount(item.unit_price_amount, bom.currency);
            const selected = !!selectedInstanceId && item.instance_ids.includes(selectedInstanceId);
            return (
              <tr
                key={item.catalog_id}
                data-testid={`bom-row-${item.catalog_id}`}
                aria-selected={selected}
                data-selected={selected ? "true" : "false"}
              >
                <th scope="row">
                  {entry ? (
                    entry.identity.model ?? item.catalog_id
                  ) : (
                    <span role="alert" data-testid={`bom-missing-catalog-${item.catalog_id}`}>
                      Unknown catalog entry
                    </span>
                  )}
                  <br />
                  <code>{item.catalog_id}</code>
                </th>
                <td data-testid={`bom-qty-${item.catalog_id}`}>{item.quantity}</td>
                <td data-testid={`bom-price-${item.catalog_id}`} data-known={unitPrice ? "true" : "false"}>
                  {unitPrice ?? "Unknown"}
                </td>
                <td>
                  <PurchaseLink item={item} />
                </td>
                <td data-testid={`bom-link-status-${item.catalog_id}`}>{LINK_STATUS_LABEL[item.link_status]}</td>
                <td>
                  <ul aria-label={`Instances of ${item.catalog_id}`}>
                    {item.instance_ids.map((id) => {
                      const resolves = known.has(id);
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            disabled={!resolves}
                            aria-pressed={selectedInstanceId === id}
                            onClick={() => onSelectInstance(id)}
                            data-testid={`bom-instance-${id}`}
                            data-broken={resolves ? "false" : "true"}
                          >
                            {id}
                            {!resolves && " (missing from build)"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {item.quantity !== item.instance_ids.length && (
                    <p role="alert" data-testid={`bom-qty-mismatch-${item.catalog_id}`}>
                      Quantity does not match referenced instances
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <footer data-testid="bom-total" data-total-status={complete ? "complete" : bom.total_status}>
        {complete && subtotal ? (
          <p>Total: {subtotal}</p>
        ) : (
          <>
            <p data-testid="bom-known-subtotal">Known subtotal: {subtotal ?? "Unknown"}</p>
            <p data-testid="bom-total-unavailable">Total unavailable: one or more prices are unknown.</p>
          </>
        )}
      </footer>
    </section>
  );
}
