"""Orchestration for POST /api/resolve: identify, resolve, gate, store.

Like the generate pipeline, this layer decides nothing about the product itself. Vision
proposes, the resolver supplies evidence, `gates.apply_gates` decides the outcome.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from rivet_api.errors import ApiError
from rivet_api.models.requests import GenerateRequest, ResolveRequest
from rivet_api.orchestration.jobs import JobSnapshot
from rivet_api.resolution.evidence import Evidence, synthetic_reason
from rivet_api.resolution.gates import GateResult, apply_gates
from rivet_api.resolution.models import Provenance, Resolution
from rivet_api.resolution.resolver import ProductResolver, ResolverResult

log = logging.getLogger("rivet_api")

SAVED_EXAMPLE_BANNER = (
    "Saved example: this result comes from built-in sample data, not from live sources. "
    "Do not rely on it."
)


def planned_resolve_stages(req: ResolveRequest) -> list[str]:
    return (["upload"] if req.input.image_asset_id else []) + ["identify", "verify", "decompose", "complete"]


def require_usable_resolver(settings, resolver: ProductResolver) -> None:
    """Live mode never falls back to sample data. Fixture mode may, and then says so."""
    if settings.mode == "live" and resolver.mode != "live":
        raise ApiError(
            "RESOLVER_UNAVAILABLE",
            "No live product resolver is configured, so this product cannot be looked up",
            503,
            {"resolver": resolver.name},
            retryable=False,
        )


def _call_resolver(resolver: ProductResolver, guess, user_text) -> ResolverResult:
    try:
        raw = resolver.resolve(guess, user_text)
    except ApiError:
        raise
    except Exception:
        log.exception("resolver %s crashed", getattr(resolver, "name", "?"))
        raise ApiError("RESOLVER_FAILED", "The product resolver failed", 502, retryable=True) from None
    try:
        result = raw if isinstance(raw, ResolverResult) else ResolverResult.model_validate(raw)
    except ValidationError as exc:
        fields = sorted({".".join(str(p) for p in e["loc"]) for e in exc.errors()})[:8]
        raise ApiError(
            "RESOLVER_CONTRACT_VIOLATION",
            "The product resolver returned a malformed result",
            502,
            {"fields": fields},
        ) from None
    if result.fetch_status == "offline":
        raise ApiError(
            "RESOLVER_OFFLINE",
            "Sources could not be reached, so nothing was resolved. No saved data was substituted",
            503,
            retryable=True,
        )
    if result.fetch_status == "blocked":
        raise ApiError(
            "RESOLVER_BLOCKED",
            "Sources refused the request, so nothing was resolved. No saved data was substituted",
            502,
        )
    if resolver.mode == "live":
        refuse_synthetic_evidence(result)
    return result


def _all_evidence(result: ResolverResult) -> list[Evidence]:
    groups = [result.product] if result.product else []
    groups += [*result.parts, *result.alternatives, *result.typical_parts]
    return [ev for group in groups for ev in group.evidence]


def refuse_synthetic_evidence(result: ResolverResult) -> None:
    """A resolver that says it is live must not return sample data (builds on #45). Nothing is
    stored: the whole job fails rather than serving stub records as a live answer."""
    found = sorted({f"{ev.source_url}: {why}" for ev in _all_evidence(result) if (why := synthetic_reason(ev))})
    if found:
        raise ApiError(
            "SYNTHETIC_EVIDENCE_IN_LIVE_RESOLUTION",
            "A live resolution contains sample or synthetic sources; only real fetched pages may be served as live",
            502,
            {"sources": found[:8]},
        )


def resolve_product(req: ResolveRequest, deps: Any, job: JobSnapshot) -> str:
    jobs, job_id = deps.jobs, job.job_id
    resolver: ProductResolver = deps.resolver

    image = None
    if req.input.image_asset_id:
        image = deps.assets.read_bytes(req.input.image_asset_id)
        jobs.emit(job_id, "upload", "system", "ok", f"Image received ({len(image[0])} bytes, {image[1]})")

    jobs.emit(job_id, "identify", "vision", "running", "Working out what the product is")
    guess = deps.vision.identify(GenerateRequest(input=req.input), image)
    if guess.verdict == "unsupported":
        jobs.emit(job_id, "identify", "vision", "warning", guess.unsupported_reason or "Not a product Rivet can reason about")
        gated: GateResult = apply_gates(guess, ResolverResult(), _now())
    else:
        what = " ".join(p for p in (guess.brand, guess.model_guess) if p) or f"unidentified {guess.category}"
        jobs.emit(job_id, "identify", "vision", "ok", f"Candidate: {what} ({guess.confidence} confidence)")
        jobs.emit(job_id, "verify", "resolver", "running", "Looking for the product at trusted sources")
        result = _call_resolver(resolver, guess, req.input.user_text)
        gated = apply_gates(guess, result, _now())
        jobs.emit(
            job_id,
            "verify",
            "resolver",
            "ok" if gated.outcome in ("exact_match", "partial_match") else "warning",
            f"Product {'confirmed' if gated.product and gated.product.status == 'verified' else 'not confirmed'}",
        )
        c = gated.counts
        jobs.emit(
            job_id,
            "decompose",
            "resolver",
            "ok" if gated.outcome == "exact_match" else "warning",
            f"{c.verified} of {c.parts_total} parts verified, {c.inferred} inferred, "
            f"{c.not_found} not found, {c.stale} out of date, {c.conflict} in conflict, {c.unavailable} unavailable",
        )

    saved = deps.vision.mode != "live" or resolver.mode != "live"
    record = Resolution(
        resolution_id=deps.resolutions.new_id(),
        created_at=_now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        outcome=gated.outcome,
        headline=gated.headline,
        input={
            "kind": req.input.kind,
            "image_asset_id": req.input.image_asset_id,
            "user_text": req.input.user_text,
        },
        guess=guess,
        product=gated.product,
        parts=gated.parts,
        alternatives=gated.alternatives,
        typical_parts=gated.typical_parts,
        conflicts=gated.conflicts,
        counts=gated.counts,
        unsupported_reason=gated.unsupported_reason,
        ledger=gated.ledger,
        provenance=Provenance(
            vision_mode=deps.vision.mode,
            resolver=resolver.name,
            resolver_mode=resolver.mode,
            saved_example=saved,
            banner=SAVED_EXAMPLE_BANNER if saved else None,
        ),
    )
    deps.resolutions.save(record.model_dump(mode="json"))
    jobs.complete_resolution(job_id, record.resolution_id)
    return record.resolution_id


def _now() -> datetime:
    return datetime.now(timezone.utc)
