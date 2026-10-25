# Rivet 3D generation: living capability checklist

Updated 2026-10-24 on `feat/3d-generation-complete`. `working` = exercised by a test or recorded run listed here; `partial` = implemented with a stated gap; `blocked` = needs an external resource; `open` = not done. Baseline audit: [`3d-capability-audit.md`](3d-capability-audit.md). Report: [`3d-generation-final-report.md`](3d-generation-final-report.md).

| Req | Status | Code path | Evidence |
|---|---|---|---|
| A1 typed distilled intent | working | `services/api/rivet_api/design/orchestrator.py` `Run.distill`, `procedural.distill`, `providers.OpenAIDesignProvider.distill` | `test_design_v2.py` (all runs); live gpt-4o distill in `scripts/live_design_smoke.py` |
| A2 reference image controls geometry | working (offline: silhouette + colours only) | `procedural.image_measurements`, content-addressed upload in `routes/design_v2.py` | `test_different_reference_images_produce_different_geometry` (sha recorded, digests differ) |
| A3 concept art via injected image provider | blocked (live) | `providers.OpenAIImageProvider.concept`, `Run.references` | live call returned 400: image model `gpt-image-1` not available to the configured key; fixture mode skips with an explicit `concept_ready` warning |
| A4 aligned extra views + contradiction check | partial | `OpenAIImageProvider.view`, `OpenAIDesignProvider.compare_views` | not exercised live (blocked with A3); offline references are labelled renders |
| A5 strict DesignSpec | working | `packages/engineering/rivet_engine/design_ir/models.py`, `contracts/design-spec.v2.schema.json` | `test_design_compiler.py` (schema sync, world-pose and ungrounded-id rejection) |
| B1 three diverse concurrent candidates | working | `Run.generate`, `topology_signature` | `test_three_distinct_candidates_...`; live run: 2 of 3 specs valid, 1 rejected after its repair round |
| B2 multi-body compiler, DAG, joints | working | `geometry/constraints.py`, `design_compiler.py` | fixtures (2WD, 4WD, arm with hinge/slide/shaft, housing, bird) |
| B3 parametric CAD + GLB/STEP/STL | working | `geometry/parametric.py`, `features.py`, `occ.py`, `exports.py` | `test_parametric_shapes_are_closed_solids` (14 types), housing STEP/STL test |
| B4 occupancy / mesh route | working | `geometry/freeform.py` | occupancy watertight test, STL import test, organic fixture |
| B5 connectivity-first layout and repair | partial | anchor DAG (connected by construction), `geometry/repair.py` | no region grow/merge on voxel micro-elements; connectivity comes from attachments |
| B6 styling and surface treatment | partial | fillets, chamfers, grills, windows, regions | strong in offline archetypes; live-authored designs were plain (3-4 bodies) |
| B7 real variants (4WD, references, sensor height) | working | `procedural._vehicle`, fixtures | 4WD test (4 anchored wheels + `unsupported`), taller-pod test (+18 mm), reference test |
| B8 purchased / fabricated / concept_visual | working | `DesignBody.kind`, `engineering_bridge.py`, BOM classes | bridge and BOM tests |
| B9 VL53L0X visual | working | `geometry/catalog_geometry.tof_breakout`; web `recipes/TofSensor.tsx`, `CATALOG_RECIPES` | `test_tof_sensor_has_its_own_breakout_geometry...`; `tests/design-v2.test.tsx`; `PartAssembly.test.tsx` now expects `tof_sensor` |
| C1 broad + narrow collision, contact classes, sweeps | working | `geometry/collision.py` | clash test names `controller`/`motor_driver`; sweep checks on arm joints |
| C2 connectivity, mounts, access | partial | `constraints.solve` unresolved list, `collision.access_rays` | bolt-pattern/shaft fit for purchased parts is reported UNKNOWN, not validated |
| C3 support polygon, COM, uncertainty | working | `geometry/stability.py` | unstable-footprint test (range over unknown masses) |
| C4 bounded deterministic repair | working | `geometry/repair.py` | clash test: repaired, nothing deleted, actions logged |
| C5 model-guided patch repair | partial | `Run.evaluate` model patch + rollback | wired and called live; no recorded successful live repair yet |
| C6 engine gates authoritative | working | `rivet_engine/engineering_bridge.py` | 2WD stack verified by `rivet_engine.solve`; template mechanical findings listed as superseded |
| C7 separate claim statuses | working | `engineering_bridge.claims` | `test_engineered_rover_is_honest...`, UI badges |
| D1 six consistent renders from real assets | working (raster) | `design/render.py` (`chromium` optional) | deterministic render digest; six PNGs per candidate |
| D2 VisualReview bound to bodies | working | `design/critic.py` | fixture metrics in tests; live gpt-4o critique in the smoke run (6.8 and 4.7 with issues) |
| D3 feasibility-first ranking, user choice | working | `Run.rank`, `/select` | tests and acceptance spec |
| D4 critic-informed revision with rollback | working | `Run.refine` | `revision_ready` in every full run; iteration records before/after digests |
| D5 select, NL change, undo/redo, job-bound | working | `/select` (job_id check), `/revise`, `/restore` | `test_select_another_candidate_then_undo`, wider-chassis test |
| E1 streamed partial geometry | working | compile progress -> `geometry_preview` assets; `PreviewSwapper` | API test (partial then final GLB); Playwright acceptance |
| E2 typed SSE, replay ids, durable, cancel | working (restart: jobs marked failed, not resumed) | `design/artifacts.py`, `routes/design_v2.py` | cancel test, event id order test |
| E3 arbitrary assemblies, layers, picking | partial | `GeneratedAssembly.tsx`, `DesignLayers.tsx` | no joint/mount/collision overlays in the viewer yet |
| E4 candidate comparison UI | working | `CandidateCompare.tsx`, `VisualDiff.tsx` | Vitest + acceptance screenshot |
| E5 robust free-text editing | partial | `procedural.edit` (offline), `OpenAIDesignProvider.patch` (live) | wider-chassis revision test; part replacement by text not supported offline |
| E6 full persistence and lineage | working | `DesignStore`, generation trace asset | revision immutability test |
| E7 content-addressed cache and replay | working | `cache_key`, `Run.replay` | byte-identical digests, zero spend, `cached` label |
| E8 exports | working | `/export` | GLB, STEP, STL, BOM, firmware ZIP; 422 with reason otherwise |
| Test 22 blinded A/B vs frozen baseline | open | n/a | not run |
