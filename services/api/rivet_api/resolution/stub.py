"""Deterministic stand-in for lane B's resolver. Returns the section 5.1 Evidence shape.

It knows three things, all clearly synthetic (reserved `.invalid` hosts, `STUB-` SKUs):
  DJI Mini 4          every part verified            -> exact_match
  Parrot Anafi        some parts inferred or missing -> partial_match
  anything else       no product                     -> no_match_with_alternatives
It does no network access and reads nothing from the image. Its mode is "fixture", so any
resolution it produces carries the saved-example banner and is refused in live mode.
"""

import hashlib
from datetime import datetime, timezone
from typing import Callable

from rivet_api.agents.product import ProductGuess
from rivet_api.resolution.evidence import Evidence, Extractor, HostTier
from rivet_api.resolution.resolver import (
    AlternativeProduct,
    PartCandidate,
    ProductCandidate,
    ResolverMode,
    ResolverResult,
    TypicalPart,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class StubResolver:
    name = "stub"
    mode: ResolverMode = "fixture"

    def __init__(self, clock: Callable[[], datetime] = _now):
        self._clock = clock

    # -- evidence ---------------------------------------------------------------
    def _ev(
        self,
        claim: str,
        value: str,
        slug: str,
        tier: HostTier = "manufacturer",
        extractor: Extractor = "jsonld",
    ) -> Evidence:
        page = f"{claim.upper()}: {value}"
        return Evidence(
            claim=claim,
            value=value,
            source_url=f"https://{tier}.stub.invalid/{slug}",
            source_host_tier=tier,
            fetched_at=self._clock().strftime("%Y-%m-%dT%H:%M:%SZ"),
            content_sha256=hashlib.sha256(page.encode()).hexdigest(),
            extractor=extractor,
            matched_text=page,
            ttl_days=14,
        )

    def _part(self, part_id: str, name: str, sku: str, tier: HostTier = "distributor") -> PartCandidate:
        return PartCandidate(part_id=part_id, name=name, sku=sku, evidence=[self._ev("sku", sku, part_id, tier)])

    # -- resolve ----------------------------------------------------------------
    def resolve(self, guess: ProductGuess, user_text: str | None) -> ResolverResult:
        brand = (guess.brand or "").casefold()
        model = (guess.model_guess or "").casefold()
        if brand == "dji" and model.startswith("mini 4"):
            return self._dji_mini_4()
        if brand == "parrot" and model.startswith("anafi"):
            return self._parrot_anafi()
        return self._no_match(guess)

    def _dji_mini_4(self) -> ResolverResult:
        sku = "STUB-DJI-MINI4"
        return ResolverResult(
            product=ProductCandidate(
                brand="DJI", name="DJI Mini 4", sku=sku, evidence=[self._ev("sku", sku, "dji-mini-4")]
            ),
            parts=[
                self._part("frame", "Frame", "STUB-FRAME-01"),
                self._part("motor", "Brushless motor", "STUB-MOTOR-01"),
                self._part("battery", "Flight battery", "STUB-BATT-01"),
                PartCandidate(
                    part_id="gimbal",
                    name="Gimbal",
                    unavailable_reason="Sold only as part of the camera module",
                ),
            ],
        )

    def _parrot_anafi(self) -> ResolverResult:
        sku = "STUB-PARROT-ANAFI"
        return ResolverResult(
            product=ProductCandidate(
                brand="Parrot", name="Parrot Anafi", sku=sku, evidence=[self._ev("sku", sku, "parrot-anafi")]
            ),
            parts=[
                self._part("frame", "Frame", "STUB-FRAME-02"),
                PartCandidate(
                    part_id="motor",
                    name="Brushless motor",
                    sku="STUB-MOTOR-02",
                    evidence=[self._ev("sku", "STUB-MOTOR-02", "teardown-anafi", "teardown")],
                ),
                PartCandidate(part_id="battery", name="Flight battery"),
            ],
            typical_parts=[
                TypicalPart(
                    name="Brushless motor",
                    rationale="1 of 1 comparable drones in the saved example use a brushless motor",
                    sku="STUB-MOTOR-01",
                    evidence=[self._ev("sku", "STUB-MOTOR-01", "motor-reference", "distributor")],
                )
            ],
        )

    def _no_match(self, guess: ProductGuess) -> ResolverResult:
        if guess.category != "drone":
            return ResolverResult()
        sku = "STUB-DJI-MINI4"
        return ResolverResult(
            alternatives=[
                AlternativeProduct(
                    brand="DJI",
                    name="DJI Mini 4",
                    sku=sku,
                    reason="Same category (drone) with every part sourced",
                    evidence=[self._ev("sku", sku, "dji-mini-4")],
                )
            ],
            typical_parts=[
                TypicalPart(
                    name="Brushless motor",
                    rationale="1 of 1 comparable drones in the saved example use a brushless motor",
                    sku="STUB-MOTOR-01",
                    evidence=[self._ev("sku", "STUB-MOTOR-01", "motor-reference", "distributor")],
                )
            ],
        )
