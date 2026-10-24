# Visual-system handoff (#37)

The integration branch owns the coordinated C/DESIGN handoff. `tokens.css` is the single CSS token definition, imported by `globals.css`. Preserve existing --rv-* names and component props. Base controls use .rv-btn, .rv-select, .rv-input, .rv-menu and .rv-dialog styles; framework wrappers are unnecessary.

Keep breakpoints 700 and 1100 pixels consistent with StudioShell and CSS media queries. Style ProductCard and BuildOverview with these tokens. Never change BuildPlan data, selection IDs, transforms, or the renderer as a styling shortcut.

Review the four annotated screenshots, keyboard focus, long-panel viewport regression and normal/reduced-motion presentation. The handoff is delivered in the combined PR; stakeholder approval remains a review action, not an assumed sign-off.
