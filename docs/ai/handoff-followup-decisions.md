# Handoff follow-up decisions

This note records the remaining scope choices from the 2026-10-22 Handoff review.
It does not claim that every feature in the sealed derivative was ported.

## Display UI knowledge aggregation

Keep the Original's `display-ui-*` names and per-widget neutral taxonomy. Each
widget remains an independent pattern with `widgetCount: 1`; repeated widget
classes across record formats are counted as separate observations. This keeps
the existing Original catalog contract and avoids a silent schema reduction to
the derivative's grouped-pattern format. The multi-format fixture in
`tests/knowledge-neutral-display-ui.test.js` locks this behavior.

## Remaining optional runtime deltas

Journal decoding, service-description lookup, joblog diagnostics, and the other
runtime extensions listed in the review remain deferred. The review describes
them as optional extensions and supplies no adopted target contract or
acceptance fixture for this Original. A future port needs an explicit helper
API, error behavior, bounds, and synthetic-driver tests before adding those
surfaces. The current Db2 batch/export behavior remains independently covered.

## Out of scope for this integration

The Handoff review explicitly does not require exchange hubs, gated write
paths, GitLab lifecycle code, or a broad package-wide rename. Original GitHub
identity, existing write gates, and display-file command contracts stay in
place.
