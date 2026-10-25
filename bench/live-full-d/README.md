# Visual benchmark (live providers, renderer chromium)

Fresh, uncached runs through the real API. Visual scores are subjective judgements of rendered geometry against the references; they never count toward mechanical or electrical verification.

| Case | Status | Candidates (strategy: score, feasible, bodies) | Selected | Visual target | Calls with images | Revision | Spent (est. USD) |
|---|---|---|---|---|---|---|---|
| asymmetric | needs_review | closest_to_reference: failed<br>simpler_manufacture: 6.8/10, feasible, 13 bodies<br>signature_geometry: 6.0/10, feasible, 14 bodies | cand-2 | NOT met (6.8/8.0, 2 rounds) | 11/16 (64 images) | kept; geometry changed | 2.52 |

Distinct geometry digests across all completed candidates: 2/2.

Per case: `original_reference.*`, `reference_<view>_<source>.png`, `cand-N/{spec.json,scene.glb,shot_<view>.png,visual_review.json,mechanical.json,revision_history.json,contact_sheet.png}`, `final/` exports of the selected candidate, `revision/` after the natural-language edit, `trace.json` (provider calls with image counts), `events.jsonl`, `bundle.json`.
