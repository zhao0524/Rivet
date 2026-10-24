import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BOMPanel, OffersPanel, PartInspector, type OffersState } from "..";
import { catalog, makePlan } from "./panel-fixtures";
import { offerFixture } from "../../../../lib/offers/fixtures";
import { HONESTY_FOOTER } from "../../../../lib/offers/format";

afterEach(cleanup);

const NOW = new Date("2026-10-24T14:00:00Z");
const ready = (name: Parameters<typeof offerFixture>[0]): OffersState => ({ status: "ready", offerSet: offerFixture(name) });

describe("OffersPanel with the synthetic multivendor fixture", () => {
  it("renders the banner, sections, labels and honesty footer", () => {
    render(<OffersPanel state={ready("synthetic-multivendor")} now={NOW} />);
    const panel = screen.getByTestId("offers-panel");
    expect(panel.dataset.state).toBe("ready");
    expect(screen.getByTestId("offers-banner").textContent).toContain("SYNTHETIC TEST-ONLY offers");
    expect(screen.getByTestId("offers-banner").textContent).toContain("Not a live lookup");
    expect(screen.getByTestId("offers-partial-notice")).toBeTruthy();
    expect(screen.getByTestId("offers-list-offers").children).toHaveLength(8);
    expect(screen.getByTestId("offers-possible-matches")).toBeTruthy();
    expect(within(screen.getByTestId("offers-list-possible_matches")).getByTestId("offer-match").dataset.matchKind).toBe("fuzzy");
    expect(screen.getByTestId("offers-alternatives").textContent).toContain("TEST-MV-3802");
    expect(screen.getByTestId("offers-ledger").textContent).toContain("Sources checked (14)");
    expect(screen.getByTestId("offers-honesty-footer").textContent).toContain(HONESTY_FOOTER);
  });

  it("ranks by reliability by default and keeps fuzzy matches out of the ranked list", () => {
    render(<OffersPanel state={ready("synthetic-multivendor")} now={NOW} />);
    const ranked = within(screen.getByTestId("offers-list-offers")).getAllByTestId("offer-match");
    expect(ranked.every((el) => el.dataset.matchKind !== "fuzzy")).toBe(true);
    const first = screen.getByTestId("offers-list-offers").children[0] as HTMLElement;
    expect(first.dataset.offerId).toBe("dist-one:e4c8a313d8534aef");
  });

  it("shows price, pack basis, availability, rating, freshness and status labels honestly", () => {
    render(<OffersPanel state={ready("synthetic-multivendor")} now={NOW} />);
    const noPrice = screen.getByTestId("offer-card-dist-two:2f1bc3376bcf7531");
    expect(within(noPrice).getByTestId("offer-price").textContent).toBe("Price not stated");
    expect(within(noPrice).getByTestId("offer-price").dataset.known).toBe("false");
    expect(within(noPrice).getByTestId("offer-availability").textContent).toBe("Backorder");
    const pack = screen.getByTestId("offer-card-dist-one:e4e5560d62dc624a");
    expect(within(pack).getByTestId("offer-pack").textContent).toBe("3-pack, price per pack (4.00 each)");
    const rated = screen.getByTestId("offer-card-dist-one:e4c8a313d8534aef");
    expect(within(rated).getByTestId("offer-rating").textContent).toBe("4.6 (128)");
    expect(within(rated).getByTestId("offer-freshness").textContent).toBe("checked 2 h ago");
    expect(within(pack).getByTestId("offer-rating").textContent).toBe("No rating on vendor page");
    const stale = screen.getByTestId("offer-card-dist-two:cfa9b01d78023178");
    expect(stale.dataset.status).toBe("stale");
    expect(within(stale).getByTestId("offer-status-label").textContent).toBe("Stale: checked 65 days ago");
    const broken = screen.getByTestId("offer-card-maker-shop:383b8a45b8f44efc");
    expect(within(broken).getByTestId("offer-status-label").textContent).toContain("Demoted: link check returned 404");
    expect(within(broken).getByTestId("offer-availability").textContent).toBe("Stock not stated");
    const eu = screen.getByTestId("offer-card-eu-reseller:cc07f8ac78c8e216");
    expect(within(eu).getByTestId("offer-price").textContent).toBe("4.20 EUR");
  });

  it("opens vendor sites in a new tab with noopener noreferrer", () => {
    render(<OffersPanel state={ready("synthetic-multivendor")} now={NOW} />);
    const links = screen.getAllByTestId("offer-open-vendor");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("href")?.startsWith("https://")).toBe(true);
    }
  });

  it("exposes the reliability factors in a tooltip tied to the badge", () => {
    render(<OffersPanel state={ready("synthetic-multivendor")} now={NOW} />);
    const badge = screen.getByTestId("offer-reliability-bargain-bay:877c148882e83900");
    expect(badge.dataset.level).toBe("medium");
    const tip = screen.getByTestId("offer-reliability-tooltip-bargain-bay:877c148882e83900");
    expect(badge.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.textContent).toContain("Price vs median: 0 (weight 0.1). 0.99 is 78% below the 4.50 median");
    expect(tip.textContent).toContain("5.0 from a single review carries little weight");
    expect(badge.tabIndex).toBe(0);
  });

  it("re-sorts and filters locally and shows an empty state when nothing matches", () => {
    render(<OffersPanel state={ready("synthetic-multivendor")} now={NOW} />);
    fireEvent.change(screen.getByTestId("offers-sort"), { target: { value: "price_asc" } });
    let cards = Array.from(screen.getByTestId("offers-list-offers").children) as HTMLElement[];
    expect(cards[0].dataset.offerId).toBe("bargain-bay:877c148882e83900");
    expect(cards[cards.length - 1].dataset.offerId).toBe("dist-two:2f1bc3376bcf7531");

    fireEvent.click(screen.getByTestId("offers-tier-manufacturer"));
    cards = Array.from(screen.getByTestId("offers-list-offers").children) as HTMLElement[];
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.dataset.vendorTier === "manufacturer")).toBe(true);

    fireEvent.change(screen.getByTestId("offers-min-rating"), { target: { value: "4" } });
    expect(screen.getByTestId("offers-empty-after-filter").textContent).toContain("No offer matches the current filters");
    expect(screen.queryByTestId("offers-not-found")).toBeNull();
    expect(screen.getByTestId("offers-possible-matches")).toBeTruthy();

    fireEvent.click(screen.getByTestId("offers-clear-filters"));
    expect(screen.getByTestId("offers-list-offers").children).toHaveLength(8);
  });

  it("filters by currency without converting", () => {
    render(<OffersPanel state={ready("synthetic-multivendor")} now={NOW} />);
    fireEvent.change(screen.getByTestId("offers-currency"), { target: { value: "EUR" } });
    const cards = Array.from(screen.getByTestId("offers-list-offers").children) as HTMLElement[];
    expect(cards.map((c) => c.dataset.currency)).toEqual(["EUR"]);
  });
});

describe("OffersPanel other states", () => {
  it("not-found shows the no-link explanation and no cards", () => {
    render(<OffersPanel state={ready("not-found-9999999")} now={NOW} />);
    expect(screen.getByTestId("offers-not-found").textContent).toContain("No verified offer was found; no link is shown because none was verified.");
    expect(screen.queryByTestId("offer-open-vendor")).toBeNull();
    expect(screen.queryByTestId("offers-toolbar")).toBeNull();
    expect(screen.queryByTestId("offers-banner")).toBeNull();
  });

  it("refused shows the synthetic explanation and the ledger", () => {
    const offerSet = offerFixture("refused-synthetic-demo-part");
    render(<OffersPanel state={{ status: "refused", offerSet, message: "" }} now={NOW} />);
    expect(screen.getByTestId("offers-panel").dataset.state).toBe("refused");
    expect(screen.getByTestId("offers-refused").textContent).toContain("synthetic placeholder");
    expect(screen.getByTestId("offers-ledger").textContent).toContain("nothing to search");
    expect(screen.getByTestId("offers-honesty-footer")).toBeTruthy();
  });

  it("a recorded real set served from fixtures is still labelled not live", () => {
    render(<OffersPanel state={ready("sparkfun-rob-13301")} savedExample now={NOW} />);
    expect(screen.getByTestId("offers-banner").textContent).toContain("Not a live lookup");
    expect(screen.getByTestId("offers-banner").dataset.synthetic).toBe("false");
    expect(screen.getByTestId("offer-availability").textContent).toBe("Stock not stated");
    expect(screen.getByTestId("offer-price").textContent).toBe("14.95 USD");
  });

  it("a live recorded set has no not-live banner", () => {
    render(<OffersPanel state={ready("adafruit-3801")} now={NOW} />);
    expect(screen.queryByTestId("offers-banner")).toBeNull();
    expect(screen.queryByTestId("offers-stale-warning")).toBeNull();
  });

  it("warns when every offer is stale", () => {
    const offerSet = offerFixture("adafruit-3801");
    offerSet.offers[0].status = "stale";
    offerSet.offers[0].fetched_at = "2026-08-01T00:00:00Z";
    render(<OffersPanel state={{ status: "ready", offerSet }} now={NOW} />);
    expect(screen.getByTestId("offers-stale-warning")).toBeTruthy();
    expect(screen.getByTestId("offer-status-label").textContent).toBe("Stale: checked 84 days ago");
  });

  it("loading, idle and error states, with retry only when it may help", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<OffersPanel state={{ status: "loading" }} />);
    expect(screen.getByTestId("offers-loading")).toBeTruthy();
    rerender(<OffersPanel state={{ status: "idle" }} />);
    expect(screen.getByTestId("offers-idle")).toBeTruthy();
    rerender(<OffersPanel state={{ status: "error", error: { code: "PROVIDER_UNAVAILABLE", message: "down", retryable: true } }} onRetry={onRetry} />);
    expect(screen.getByTestId("offers-error").dataset.code).toBe("PROVIDER_UNAVAILABLE");
    fireEvent.click(screen.getByTestId("offers-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<OffersPanel state={{ status: "error", error: { code: "CONTRACT_VIOLATION", message: "bad", retryable: false } }} onRetry={onRetry} />);
    expect(screen.queryByTestId("offers-retry")).toBeNull();
  });
});

describe("Offers inside PartInspector and BOMPanel", () => {
  it("PartInspector renders the offers panel for the selected part when given", () => {
    render(
      <PartInspector plan={makePlan()} catalog={catalog} selectedInstanceId="motor-left-1" offers={{ state: ready("synthetic-multivendor"), now: NOW }} />,
    );
    expect(within(screen.getByTestId("part-inspector")).getByTestId("offers-panel")).toBeTruthy();
  });

  it("BOMPanel shows a compact Where to buy per row with safe links and test-only labelling", () => {
    const plan = makePlan();
    const offers: Record<string, OffersState> = {
      "demo.tt_motor": ready("synthetic-multivendor"),
      "demo.chassis_2wd": { status: "refused", offerSet: null, message: "" },
      "board.sourced_controller": { status: "loading" },
    };
    render(<BOMPanel plan={plan} catalog={catalog} onSelectInstance={() => {}} offers={offers} />);
    const motor = screen.getByTestId("bom-offers-demo.tt_motor");
    expect(motor.dataset.state).toBe("ready");
    expect(motor.dataset.synthetic).toBe("true");
    expect(within(motor).getAllByRole("link")).toHaveLength(3);
    for (const a of within(motor).getAllByRole("link")) expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(motor.textContent).toContain("Test-only or stub data, not a live lookup");
    expect(motor.textContent).toContain("Rivet does not sell parts");
    expect(screen.getByTestId("bom-offers-demo.chassis_2wd").dataset.state).toBe("refused");
    expect(screen.getByTestId("bom-offers-board.sourced_controller").dataset.state).toBe("loading");
    expect(screen.queryByTestId("bom-offers-driver.reference_only")).toBeNull();
  });
});
