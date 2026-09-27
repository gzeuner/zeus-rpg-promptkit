# GUI Accessibility Walkthrough

This is the repeatable manual check for the local Zeus GUI. It complements automated contract tests; it is not a WCAG certification.

Current scope decision (2026-09-27): the owner cancelled the formal NVDA/visual forced-colors walkthrough for this release and reported an informal smoke walkthrough. The procedure below remains a reference, not a required release gate. This decision supersedes earlier pending-follow-up wording; it does not establish screenreader compatibility or WCAG conformance.

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

### Candidate review — 2026-09-27

Base: synchronized `main` at `261324af4c633ad35a306ed9c5b28efa209ab51a`, plus uncommitted local fixes. Package version remains `0.3.0-rc.2`; this is not a test of a published `0.3.0` artifact.

- A real Chrome keyboard regression reproduced lost focus after tab activation. The fix restores navigation focus after rendering, including a report tab whose old panel becomes hidden, without overriding a newer user focus. Native Enter/Space activation is retained.
- The Reports tab previously referenced a nonexistent `reports` panel. Main views now have real, named tab panels; Advanced and Workbench share their parent panel.
- Browser-emulated `forced-colors: active` and reduced motion are exercised, not merely detected in source text. The test verifies a visible 3px focus outline, a contrasting 3px selected-tab border, reduced transition duration, and no horizontal page overflow at 390px. This does **not** attest to a Windows high-contrast theme or a visual review.
- `npm run test:e2e:gui`: all three browser tests pass with synthetic local data. These checks use Chrome keyboard input through CDP; they are not screenreader output.
- Real NVDA speech-output verification and the visual forced-colors walkthrough were discontinued by explicit owner decision on 2026-09-27. The owner reported having performed an informal smoke walkthrough; exact steps, spoken output, browser version, and high-contrast coverage were not recorded. This is not a formal pass.

Disposition: removed from this release's required checks, not left as an outstanding blocker. Existing automated keyboard and forced-colors regression tests remain in place. No screenreader pass or WCAG conformance is claimed.

If a future release explicitly reintroduces this walkthrough, record the actual NVDA/browser versions and spoken names, roles, selected state, panel transitions, setup disclosures, and catalog navigation. Review forced colors visually as well as through computed styles, and restore temporary test settings afterward.
