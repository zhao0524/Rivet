import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BOMPanel, PartInspector, ProjectRevisionPicker, VerificationPanel } from "..";
import { catalog, makePlan } from "./panel-fixtures";

afterEach(cleanup);

describe("PartInspector", () => {
  it("shows catalog identity, unknown dimensions and synthetic provenance", () => {
    render(<PartInspector plan={makePlan()} catalog={catalog} selectedInstanceId="motor-left-1" />);
    expect(screen.getByTestId("inspector-catalog-id").textContent).toBe("demo.tt_motor");
    expect(screen.getByTestId("inspector-role").textContent).toBe("drive_motor_left");
    expect(screen.getByTestId("inspector-manufacturer").textContent).toBe("SYNTHETIC DEMO ONLY");
    expect(screen.getByTestId("inspector-sku").textContent).toBe("Unknown");
    expect(screen.getByTestId("inspector-dim-x").textContent).toBe("70");
    expect(screen.getByTestId("inspector-dim-y").dataset.known).toBe("false");
    expect(screen.getByTestId("inspector-bounds-verified").textContent).toBe("Bounds not verified");
    expect(screen.getByTestId("inspector-evidence-dimensions").textContent).toBe("synthetic_approximation");
    expect(screen.getByTestId("inspector-synthetic-notice")).toBeTruthy();
    expect(screen.getByTestId("inspector-generation-mode").textContent).toBe("fixture");
  });

  it("distinguishes repeated catalog parts and lets the user jump to a sibling", () => {
    const onSelect = vi.fn();
    render(<PartInspector plan={makePlan()} catalog={catalog} selectedInstanceId="motor-right-1" onSelectInstance={onSelect} />);
    expect(screen.getByTestId("part-inspector").dataset.instanceId).toBe("motor-right-1");
    expect(screen.getByTestId("inspector-bom-quantity").textContent).toContain("2 of 2");
    fireEvent.click(screen.getByTestId("inspector-sibling-motor-left-1"));
    expect(onSelect).toHaveBeenCalledWith("motor-left-1");
  });

  it("lists related assembly steps and only this instance's findings", () => {
    render(<PartInspector plan={makePlan()} catalog={catalog} selectedInstanceId="motor-right-1" />);
    expect(within(screen.getByTestId("inspector-steps")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByTestId("inspector-step-2")).toBeTruthy();
    expect(screen.queryByTestId("inspector-finding-electrical.motor_current")).toBeNull();
    expect(screen.getByTestId("inspector-finding-fixture.synthetic_not_sourced").dataset.blocking).toBe("true");
  });

  it("never fabricates links or prices for an unsourced part", () => {
    render(<PartInspector plan={makePlan()} catalog={catalog} selectedInstanceId="driver-1" />);
    const purchase = screen.getByTestId("inspector-link-purchase");
    expect(purchase.tagName).toBe("SPAN");
    expect(purchase.textContent).toBe("Not available");
    expect(screen.getByTestId("inspector-link-manufacturer").getAttribute("href")).toBe("https://maker.example/drv-1");
    expect(screen.getByTestId("inspector-price").textContent).toBe("Unknown");
    expect(screen.getByTestId("inspector-link-status").dataset.linkStatus).toBe("manufacturer_reference_only");
    expect(screen.getByTestId("inspector-finding-electrical.motor_current").dataset.result).toBe("FAIL");
  });

  it("shows sourced data as provided", () => {
    render(<PartInspector plan={makePlan({ provenance: { input_mode: "text", catalog_version: "v2", generation_mode: "live", notes: [] } })} catalog={catalog} selectedInstanceId="controller-1" />);
    expect(screen.getByTestId("inspector-link-purchase").getAttribute("href")).toBe("https://shop.example/cb-100");
    expect(screen.getByTestId("inspector-price").textContent).toBe("9.50 USD");
    expect(screen.getByTestId("inspector-sku").textContent).toBe("CB-100");
    expect(screen.queryByTestId("inspector-synthetic-notice")).toBeNull();
  });

  it("reports broken references instead of rendering invented data", () => {
    const { rerender } = render(<PartInspector plan={makePlan()} catalog={catalog} selectedInstanceId="ghost-1" />);
    expect(screen.getByTestId("inspector-missing-catalog")).toBeTruthy();
    expect(screen.getByTestId("inspector-bom-missing")).toBeTruthy();
    rerender(<PartInspector plan={makePlan()} catalog={catalog} selectedInstanceId="nope-9" />);
    expect(screen.getByTestId("part-inspector-missing-instance").textContent).toContain("nope-9");
    rerender(<PartInspector plan={makePlan()} catalog={catalog} selectedInstanceId={null} />);
    expect(screen.getByTestId("part-inspector-empty")).toBeTruthy();
  });
});

describe("BOMPanel", () => {
  it("derives rows from plan.bom.items and selects a specific repeated instance", () => {
    const onSelect = vi.fn();
    const plan = makePlan();
    render(<BOMPanel plan={plan} catalog={catalog} selectedInstanceId="motor-right-1" onSelectInstance={onSelect} />);
    expect(screen.getByTestId("bom-row-count").textContent).toBe(`${plan.bom.items.length} line items`);
    expect(screen.getByTestId("bom-qty-demo.tt_motor").textContent).toBe("2");
    expect(screen.getByTestId("bom-row-demo.tt_motor").dataset.selected).toBe("true");
    expect(screen.getByTestId("bom-instance-motor-right-1").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("bom-instance-motor-left-1"));
    expect(onSelect).toHaveBeenCalledWith("motor-left-1");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("labels incomplete pricing without inventing a total", () => {
    render(<BOMPanel plan={makePlan()} catalog={catalog} onSelectInstance={() => {}} />);
    expect(screen.getByTestId("bom-price-demo.tt_motor").textContent).toBe("Unknown");
    expect(screen.getByTestId("bom-price-board.sourced_controller").textContent).toBe("9.50 USD");
    expect(screen.getByTestId("bom-known-subtotal").textContent).toBe("Known subtotal: 9.50 USD");
    expect(screen.getByTestId("bom-total-unavailable").textContent).toContain("Total unavailable");
    expect(screen.getByTestId("bom-total").textContent).not.toMatch(/^Total:/);
  });

  it("does not show a subtotal the plan did not provide", () => {
    const plan = makePlan();
    plan.bom = { ...plan.bom, known_subtotal_amount: null, total_status: "not_available" };
    render(<BOMPanel plan={plan} catalog={catalog} onSelectInstance={() => {}} />);
    expect(screen.getByTestId("bom-known-subtotal").textContent).toBe("Known subtotal: Unknown");
  });

  it("shows a total only when complete and every row is priced", () => {
    const plan = makePlan();
    plan.bom = { currency: "USD", known_subtotal_amount: "9.50", total_status: "complete", items: [plan.bom.items[2]] };
    render(<BOMPanel plan={plan} catalog={catalog} onSelectInstance={() => {}} />);
    expect(screen.getByTestId("bom-total").textContent).toBe("Total: 9.50 USD");
    expect(screen.queryByTestId("bom-total-unavailable")).toBeNull();
  });

  it("activates links only for provided URLs and distinguishes link kinds", () => {
    render(<BOMPanel plan={makePlan()} catalog={catalog} onSelectInstance={() => {}} />);
    const verified = screen.getByTestId("bom-link-board.sourced_controller");
    expect(verified.tagName).toBe("A");
    expect(verified.getAttribute("href")).toBe("https://shop.example/cb-100");
    expect(verified.textContent).toBe("Product listing");
    const reference = screen.getByTestId("bom-link-driver.reference_only");
    expect(reference.tagName).toBe("A");
    expect(reference.textContent).toBe("Manufacturer reference");
    expect(screen.getByTestId("bom-link-status-driver.reference_only").textContent).toContain("not a store listing");
    expect(screen.getByTestId("bom-link-demo.tt_motor").tagName).toBe("SPAN");
    // link_status claims verified but no URL was provided: still no link.
    expect(screen.getByTestId("bom-link-demo.missing_part").tagName).toBe("SPAN");
    expect(document.querySelectorAll("a[href]")).toHaveLength(2);
  });

  it("flags broken catalog and instance references", () => {
    const onSelect = vi.fn();
    render(<BOMPanel plan={makePlan()} catalog={catalog} onSelectInstance={onSelect} />);
    expect(screen.getByTestId("bom-missing-catalog-demo.missing_part")).toBeTruthy();
    const broken = screen.getByTestId("bom-instance-wheel-left-1") as HTMLButtonElement;
    expect(broken.disabled).toBe(true);
    expect(broken.dataset.broken).toBe("true");
    fireEvent.click(broken);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("flags quantity that disagrees with instance references", () => {
    const plan = makePlan();
    plan.bom.items[1] = { ...plan.bom.items[1], quantity: 3 };
    render(<BOMPanel plan={plan} catalog={catalog} onSelectInstance={() => {}} />);
    expect(screen.getByTestId("bom-qty-mismatch-demo.tt_motor")).toBeTruthy();
  });
});

describe("VerificationPanel", () => {
  it("displays each result distinctly and surfaces blocking findings first", () => {
    render(<VerificationPanel plan={makePlan()} />);
    expect(screen.getByTestId("verification-overall").dataset.status).toBe("needs_review");
    expect(screen.getByTestId("verification-overall").textContent).toContain("Needs review");
    expect(screen.getByTestId("verification-overall").textContent).not.toMatch(/Verified/);
    for (const r of ["PASS", "WARN", "FAIL", "UNKNOWN"]) {
      expect(screen.getByTestId(`verification-count-${r}`).textContent).toBe(`${r}: 1`);
    }
    expect(screen.getByTestId("verification-blocking-summary").textContent).toContain("2 blocking findings");
    const items = within(screen.getByRole("list", { name: "Findings" })).getAllByTestId(/^finding-[a-z.\_]+$/);
    expect(items.map((el) => el.dataset.result)).toEqual(["FAIL", "UNKNOWN", "WARN", "PASS"]);
    expect(screen.getByTestId("finding-mechanical.fits_deck").dataset.blocking).toBe("false");
  });

  it("does not portray fixture data as verified hardware", () => {
    const plan = makePlan({ status: "verified", verification: { overall: "verified", findings: [] } });
    render(<VerificationPanel plan={plan} />);
    expect(screen.getByTestId("verification-scope-note").textContent).toContain("not a real-world safety certification");
    expect(screen.getByTestId("verification-synthetic-notice").textContent).toContain("do not describe verified physical hardware");
  });

  it("selects affected parts via callback", () => {
    const onSelect = vi.fn();
    render(<VerificationPanel plan={makePlan()} onSelectInstance={onSelect} />);
    fireEvent.click(screen.getByTestId("finding-electrical.motor_current-instance-driver-1"));
    expect(onSelect).toHaveBeenCalledWith("driver-1");
  });
});

describe("ProjectRevisionPicker", () => {
  const revisions = [
    { revision: 1, status: "needs_review" as const },
    { revision: 3, status: "unbuildable" as const, label: "cheaper" },
    { revision: 2, status: "needs_review" as const },
  ];

  it("shows revision state and only reports the choice through the callback", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <ProjectRevisionPicker buildId="b-1" revisions={revisions} currentRevision={3} onSelectRevision={onSelect} />,
    );
    const select = screen.getByLabelText("Revision of b-1") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["3", "2", "1"]);
    expect(select.options[0].textContent).toContain("(latest)");
    expect(screen.getByTestId("revision-state").dataset.latest).toBe("true");
    fireEvent.change(select, { target: { value: "1" } });
    expect(onSelect).toHaveBeenCalledWith(1);
    // Controlled: selection does not change until the integration supplies a new revision.
    expect(select.value).toBe("3");
    rerender(<ProjectRevisionPicker buildId="b-1" revisions={revisions} currentRevision={1} onSelectRevision={onSelect} />);
    expect(screen.getByTestId("revision-state").textContent).toBe("Viewing older revision 1; latest is 3");
  });

  it("disables while pending and shows errors", () => {
    render(
      <ProjectRevisionPicker buildId="b-1" revisions={revisions} currentRevision={2} onSelectRevision={() => {}} pending error="Revision 2 failed to load" />,
    );
    expect((screen.getByTestId("revision-select") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByTestId("revision-picker").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("revision-error").textContent).toBe("Revision 2 failed to load");
  });
});
