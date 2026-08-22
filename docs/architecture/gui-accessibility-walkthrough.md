# GUI Accessibility Walkthrough

This is the repeatable manual check for the local Zeus GUI. It complements automated contract tests; it is not a WCAG certification.

## Scope

- local loopback UI only
- no credentials, key material, customer data, or remote fetches
- main navigation, Reports sub-navigation, Setup checklist, profile wizard, key readiness, and live tool catalog

## Keyboard walkthrough

1. Start the local UI on loopback and open the landing page.
2. Use `Tab` from the address bar and confirm that the focus ring remains visible on every interactive element.
3. On the main tablist, use `ArrowRight`/`ArrowLeft`; focus must move between tabs without leaving the tablist. `Home` and `End` must select the first and last tab stops.
4. Press `Enter` or `Space` on the focused tab and confirm that the corresponding view opens.
5. Open Reports and repeat the same check for Overview, Graph, DB2 / Test Data, Prompt Compare, and Evidence Explorer.
6. In Setup, activate each Secure Setup Checklist `Open` button. The target details area must open and receive focus; Evidence must switch to Reports.
7. Expand Live Tool Catalog and confirm that the list is readable without execution controls. It must show declarative command, workflow, role, and theme metadata.
8. Confirm that the key readiness section says that secret values remain hidden. Do not create or rotate key material during this walkthrough.

## Visual and privacy checks

- enable reduced motion; navigation must remain usable without animated movement
- enable forced colors/high contrast; borders and focus remain visible
- resize to a narrow viewport; the layout must remain readable without horizontal page scrolling
- confirm that no credential value, private path, customer identifier, or telemetry request appears in the page

## Result record

Record the date, browser/runtime, checks performed, and any issue here after each release candidate. Automated checks currently cover the semantic markup contract, live catalog metadata, explicit allowlists, and secret-hygiene boundaries.

Current iteration result (2026-08-22): passed in the local in-app browser. Main and Reports tablists exposed stable `aria-selected`, `aria-controls`, and roving `tabindex` values; arrow/Home navigation moved focus correctly; all four checklist targets opened or navigated as intended; the live catalog rendered 31 declarative entries without execution controls; secret sentinel terms were absent; and a 390px viewport had no horizontal overflow. Reduced-motion and forced-colors rules were present and the responsive layout remained readable. A real screen-reader pass and an actual OS/browser forced-colors session remain separate follow-ups.
