# Studio component and interaction specification (#36)

## Wireframe

Desktop (1100px+): header and modes; one-line trust disclosure; three-column workspace with Request/changes/history/parts on the left, model and contextual toolbar in the center, active-mode details on the right. Assembly adds a timeline inside the center column. Export and New build open dialogs without moving the workspace.

Tablet (700–1099px): the same center workspace; Parts and Details open drawers. Phone (<700px): header modes wrap; Details is a bottom sheet. All side-panel content scrolls inside its container.

## Surface-to-component mapping

| Surface | Existing component | Behavior |
|---|---|---|
| Landing and two starts | Home page / HeroRover | Saved hero is labeled; links focus upload or prompt |
| Header, modes, drawers | Studio / StudioShell | Preserve selected instance and revision across modes; close overlays with Escape |
| Upload and interpretation | BuildIntake / ImageDropzone | Review family, confidence, assumptions and unknowns before Confirm and build; corrections invalidate preview |
| Unsupported interpretation | BuildIntake | Explicit closest-rover choice, Replace image, Describe it in words; never silently convert |
| Progress | GenerationStatus | Actual server stages; null progress stays indeterminate; errors and retry visible |
| Saved example cards | SavedExampleLauncher | Open saved plan without pretending generation ran |
| Request, edits, revisions | PartsPanel / ProjectRevisionPicker | Text request and bounded presets; rejected edits retain original revision; active revision clearly marked |
| Model selection | RoverScene / interaction controller | Hover highlights; click selects the same instance as BOM; focus and isolation remain separate states |
| View tools | Toolbar / MenuButton | Fit, view presets, exploded mode, conditional Spread, wiring and contextual isolate/hide |
| Product detail | ProductCard | One identity/source/fit/assembly card for parts-list, scene and BOM selection |
| Empty selection | BuildOverview | Known subtotal vs complete price, buy list, part counts, coverage and blocking checks |
| BOM and checks | BOMPanel / VerificationPanel | Exact revision quantities; source links with status; explicit unknowns and blocking findings |
| Assembly | Inspector / StepTimeline | Prep, step scrub, play/pause, next/previous; every BOM instance represented, kit items labeled without fake meshes |
| Wiring | WiringStatusPanel | Net selection, signal filters and plan-derived pin map |
| Simulation | SimView | Start/pause/reset and obstacle behavior; simplified-model limitation visible |
| Exports and grounding | ExportPanel | Revision-bound downloads; disabled/unavailable/ready/network-error states; Ground only when ready |

## Keyboard and motion

Use native buttons, inputs and links; keyboard activation equals pointer activation. Dialog traps focus, Escape closes, and focus returns to its opener. MenuButton supports arrow navigation and Escape. Preserve accessible labels on canvas tools and controls. Drawer content remains keyboard scrollable. Respect reduced motion in tokens; model control semantics and animation engine are unchanged.
