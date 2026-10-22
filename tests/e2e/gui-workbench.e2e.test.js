/*
 * Portable GUI E2E using Chrome DevTools Protocol directly. This keeps the
 * production package free of a browser automation dependency while still
 * exercising a real browser against the real local UI server.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { startLocalUiServer } = require('../../src/ui/localUiServer');
const {
  assertNoSensitiveTerms,
  createE2eWorkspace,
  skipOrFailPrerequisite,
} = require('./support/e2eHarness');
const { startChrome } = require('./support/chromeCdp');
const { createPopulatedGuiRun } = require('./support/guiFixture');
const { waitFor } = require('./support/e2eHarness');

test('browser keyboard navigation preserves focus and forced-colors affordances', async t => {
  const workspace = createE2eWorkspace('zeus-gui-a11y-e2e-');
  createPopulatedGuiRun(workspace.path('output'));
  let started;
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (started) await new Promise(resolve => started.server.close(resolve));
    workspace.cleanup();
  });
  try {
    started = await startLocalUiServer({
      outputRoot: workspace.path('output'),
      host: '127.0.0.1',
      port: 0,
      actionServiceOptions: { cwd: workspace.root, env: {} },
    });
    browser = await startChrome();
  } catch (error) {
    if (error?.code === 'E2E_PREREQUISITE_MISSING') {
      skipOrFailPrerequisite(t, error.message);
      return;
    }
    throw error;
  }
  await browser.navigate(started.url);
  await waitFor(() =>
    browser.evaluate(
      `Boolean(document.querySelector('[data-run]') && document.querySelector('[data-setup-checklist]'))`
    )
  );
  await browser.evaluate(`document.querySelector('[data-tab="configure"]').focus()`);
  await browser.pressKey('ArrowRight', 'ArrowRight', 39);
  assert.equal(await browser.evaluate('document.activeElement.dataset.tab'), 'reports');
  await browser.pressKey('Enter', 'Enter', 13);
  await waitFor(() =>
    browser.evaluate(`Boolean(document.querySelector('#artifacts.active [data-report-view]'))`)
  );
  await waitFor(() => browser.evaluate(`document.activeElement.dataset.tab === 'reports'`), {
    message: 'main tab focus was lost after activation',
  });
  assert.equal(
    await browser.evaluate('document.activeElement.dataset.tab'),
    'reports',
    'main tab retains focus after activation'
  );
  assert.deepEqual(
    await browser.evaluate(
      `Array.from(document.querySelectorAll('[role="tab"]')).filter(tab => tab.getClientRects().length).map(tab => tab.getAttribute('aria-controls')).filter(id => !document.getElementById(id))`
    ),
    [],
    'visible tabs control real panels'
  );
  await browser.pressKey('Tab', 'Tab', 9);
  assert.equal(await browser.evaluate('document.activeElement.dataset.reportView'), 'artifacts');
  await browser.pressKey('End', 'End', 35);
  assert.equal(await browser.evaluate('document.activeElement.dataset.reportView'), 'evidence');
  await browser.pressKey(' ', 'Space', 32);
  await waitFor(() => browser.evaluate(`Boolean(document.querySelector('#evidence.active'))`));
  await waitFor(
    () =>
      browser.evaluate(
        `document.activeElement === document.querySelector('#evidence [data-report-view="evidence"]')`
      ),
    { message: 'report tab focus was lost after activation' }
  );
  assert.equal(
    await browser.evaluate('document.activeElement.dataset.reportView'),
    'evidence',
    'report tab retains focus after activation'
  );
  await browser.pressKey('Home', 'Home', 36);
  assert.equal(await browser.evaluate('document.activeElement.dataset.reportView'), 'artifacts');
  await browser.pressKey('ArrowLeft', 'ArrowLeft', 37);
  assert.equal(await browser.evaluate('document.activeElement.dataset.reportView'), 'evidence');
  await browser.emulateMedia([
    { name: 'forced-colors', value: 'active' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  const visual = await browser.evaluate(`(() => {
    const selected = document.querySelector('#evidence [aria-selected="true"]');
    const focused = getComputedStyle(document.activeElement);
    const style = getComputedStyle(selected);
    return { forced: matchMedia('(forced-colors: active)').matches, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      outline: focused.outlineStyle, outlineWidth: focused.outlineWidth, selectedBorder: style.borderBottomWidth,
      borderContrast: style.borderBottomColor !== style.backgroundColor, transition: style.transitionDuration };
  })()`);
  assert.equal(visual.forced, true);
  assert.equal(visual.reduced, true);
  assert.equal(visual.outline, 'solid');
  assert.equal(visual.outlineWidth, '3px');
  assert.equal(visual.selectedBorder, '3px');
  assert.equal(visual.borderContrast, true);
  assert.equal(Number.parseFloat(visual.transition) <= 0.00001, true);
  await browser.setViewport(390, 844);
  assert.equal(
    await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'),
    true,
    'no horizontal page overflow at 390px'
  );
  const fetchEvidence = await browser.evaluate(`(() => {
    s.uiActions.fetchMember.result = {
      status: 'completed',
      notes: [],
      result: {
        fetched: [{ member: 'ORDERPGM', path: 'rpg_sources/ORDERPGM.rpgle', sha256: 'a'.repeat(64) }],
        freshness: { status: 'fresh', checkedAt: '2026-10-18T12:00:00.000Z' }
      }
    };
    const panel = document.createElement('div');
    panel.innerHTML = renderGuidedDiscoveryPreview({ result: { title: 'Fetch preview', status: 'ready' } });
    return panel.textContent;
  })()`);
  assert.match(fetchEvidence, /local source at fetch: fresh/);
  assert.match(fetchEvidence, /SHA-256: a{64}/);
});

test('browser can create, revise, inspect, and cancel a local collaboration task', async t => {
  const workspace = createE2eWorkspace('zeus-gui-collaboration-e2e-');
  let started;
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (started) await new Promise(resolve => started.server.close(resolve));
    workspace.cleanup();
  });
  try {
    started = await startLocalUiServer({
      outputRoot: workspace.path('output'),
      host: '127.0.0.1',
      port: 0,
      actionServiceOptions: { cwd: workspace.root, env: {} },
    });
    browser = await startChrome();
  } catch (error) {
    if (error?.code === 'E2E_PREREQUISITE_MISSING') {
      skipOrFailPrerequisite(t, error.message);
      return;
    }
    throw error;
  }

  await browser.navigate(started.url);
  await waitFor(() =>
    browser.evaluate(`Boolean(document.querySelector('[data-tab="collaboration"]'))`)
  );
  await browser.evaluate(`document.querySelector('[data-tab="collaboration"]').click()`);
  await waitFor(() => browser.evaluate(`Boolean(document.querySelector('#collaboration.active'))`));
  await browser.evaluate(`(() => {
    const goal=document.querySelector('#collaboration-goal');
    goal.value='Review a local process task';
    goal.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#collaboration-create').requestSubmit();
  })()`);
  await waitFor(() =>
    browser.evaluate(`Boolean(document.querySelector('#collaboration-task').value)`)
  );
  assert.match(
    await browser.evaluate(`document.querySelector('#collaboration-status').textContent`),
    /ready.*revision 1.*local-only/i
  );
  assert.equal(
    await browser.evaluate(`document.querySelector('#collaboration-run').disabled`),
    true
  );

  await browser.evaluate(`(() => {
    const text=document.querySelector('#collaboration-text');
    text.value='Check the evidence path';
    document.querySelector('#collaboration-message').requestSubmit();
  })()`);
  await waitFor(() =>
    browser.evaluate(
      `/revision 2/.test(document.querySelector('#collaboration-status').textContent)`
    )
  );
  await browser.evaluate(`document.querySelector('#collaboration-handoff').click()`);
  await waitFor(() =>
    browser.evaluate(`!document.querySelector('#collaboration-handoff-output').hidden`)
  );
  assert.match(
    await browser.evaluate(`document.querySelector('#collaboration-handoff-output').textContent`),
    /"approvalGranted": false/
  );
  await browser.evaluate(`document.querySelector('#collaboration-cancel').click()`);
  await waitFor(() =>
    browser.evaluate(
      `/cancelled/.test(document.querySelector('#collaboration-status').textContent)`
    )
  );
  assertNoSensitiveTerms(await browser.evaluate('document.body.innerText'));
});

test('real browser can operate the secure GUI setup and report navigation', async t => {
  const workspace = createE2eWorkspace('zeus-gui-e2e-');
  const localConfig = workspace.path('config', 'local-only');
  fs.mkdirSync(localConfig, { recursive: true });
  fs.writeFileSync(
    workspace.path('config', 'local-only', 'profiles.json'),
    `${JSON.stringify({
      dev: {
        systems: { dev: { host: 'ibmi.invalid', user: 'reader', password: 'e2e-private-token' } },
        resourceCatalog: {
          'dev.sources': {
            kind: 'sourceCode',
            system: 'dev',
            library: 'SRCLIB',
            sourceFiles: ['QRPGLESRC'],
            maxMembers: 3,
          },
        },
      },
      qa: {
        systems: { qa: { host: 'ibmi-qa.invalid', user: 'reader', password: 'e2e-private-token' } },
        resourceCatalog: {
          'qa.sources': {
            kind: 'sourceCode',
            system: 'qa',
            library: 'QASRC',
            sourceFiles: ['QRPGLESRC'],
            maxMembers: 3,
          },
        },
      },
    })}\n`,
    'utf8'
  );
  fs.writeFileSync(
    workspace.path('config', 'local-only', 'ui-configurations.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      configurations: [
        {
          id: 'dev',
          label: 'Development',
          profile: 'dev',
          config: 'config/local-only/profiles.json',
        },
        {
          id: 'qa',
          label: 'QA',
          profile: 'qa',
          config: 'config/local-only/profiles.json',
        },
      ],
    })}\n`,
    'utf8'
  );
  let connectionProbeCount = 0;
  let releaseFirstProbe;
  let markFirstProbeStarted;
  const firstProbeGate = new Promise(resolve => {
    releaseFirstProbe = resolve;
  });
  const firstProbeStarted = new Promise(resolve => {
    markFirstProbeStarted = resolve;
  });
  let started;
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (started) await new Promise(resolve => started.server.close(resolve));
    workspace.cleanup();
  });

  try {
    started = await startLocalUiServer({
      outputRoot: workspace.path('output'),
      host: '127.0.0.1',
      port: 0,
      sensitiveTerms: ['e2e-private-token'],
      actionServiceOptions: {
        cwd: workspace.root,
        connectionCheckServices: {
          db2Query: async ({ query, maxRows }) => {
            connectionProbeCount += 1;
            assert.match(query, /SELECT 1 AS HEALTHCHECK/);
            assert.equal(maxRows, 1);
            if (connectionProbeCount === 1) {
              markFirstProbeStarted();
              await firstProbeGate;
              throw new Error('synthetic connection failure');
            }
            return { rowCount: 1 };
          },
        },
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !/(password|secret|credential|token|private[_-]?key)/i.test(key)
          )
        ),
      },
    });
    browser = await startChrome();
  } catch (error) {
    if (error && error.code === 'E2E_PREREQUISITE_MISSING') {
      skipOrFailPrerequisite(t, error.message);
      return;
    }
    throw error;
  }

  await browser.navigate(started.url);
  await browser.evaluate(`new Promise(resolve => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelectorAll('[data-setup-checklist] li').length === 4) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(check, 25);
    };
    check();
  })`);
  const initial = await browser.evaluate(`(() => ({
    title: document.title,
    setupTab: document.querySelector('[aria-controls="configure"]')?.textContent?.trim(),
    reportsTab: document.querySelector('[aria-controls="reports"]')?.textContent?.trim(),
    checklistCount: document.querySelectorAll('[data-setup-checklist] li').length,
    operatorReadiness: Boolean(document.querySelector('[data-operator-readiness]')),
    probeButton: Boolean(document.querySelector('[data-config-probe]')),
    contextWizard: Boolean(document.querySelector('#workingContextWizardSection')),
    contextPreviewButton: Boolean(document.querySelector('[data-context-preview]')),
    catalog: Boolean(document.querySelector('#pluginCatalogSection')),
    setupHasProfileWizard: Boolean(document.querySelector('#configure #profileWizardSection')),
    adminHasProfileWizard: Boolean(document.querySelector('#administration #profileWizardSection')),
    adminHasKeyWizard: Boolean(document.querySelector('#administration #profileKeyWizardSection')),
    adminHasPluginCatalog: Boolean(document.querySelector('#administration #pluginCatalogSection')),
    body: document.body.innerText
  }))()`);
  assert.match(initial.title, /Zeus/i);
  assert.equal(initial.setupTab, 'Setup');
  assert.equal(initial.reportsTab, 'Reports');
  assert.equal(initial.checklistCount, 4);
  assert.equal(initial.operatorReadiness, true);
  assert.equal(initial.probeButton, true);
  assert.equal(initial.contextWizard, true);
  assert.equal(initial.contextPreviewButton, true);
  assert.equal(initial.catalog, true);
  assert.equal(initial.setupHasProfileWizard, false);
  assert.equal(initial.adminHasProfileWizard, true);
  assert.equal(initial.adminHasKeyWizard, true);
  assert.equal(initial.adminHasPluginCatalog, true);
  assertNoSensitiveTerms(initial.body, ['e2e-private-token']);
  await browser.evaluate(`(() => {
    const nativeFetch=window.fetch.bind(window);
    window.__releaseQaSelection=null;
    window.__qaSelectionHeld=new Promise(resolve=>{window.__releaseQaSelection=resolve;});
    window.__qaSelectionStarted=false;
    window.fetch=async (url,options={})=>{
      const response=await nativeFetch(url,options);
      if(String(url).startsWith('/api/ui-configuration')&&options.method==='POST'&&JSON.parse(options.body||'{}').configurationId==='qa'){
        window.__qaSelectionStarted=true;
        await window.__qaSelectionHeld;
      }
      return response;
    };
  })()`);
  await browser.evaluate(
    `(() => {const select=document.querySelector('#namedEnvironmentSelect');select.value='qa';select.dispatchEvent(new Event('change',{bubbles:true}));})()`
  );
  await waitFor(() => browser.evaluate('window.__qaSelectionStarted===true'));
  await browser.evaluate(
    `(() => {const select=document.querySelector('#namedEnvironmentSelect');select.value='dev';select.dispatchEvent(new Event('change',{bubbles:true}));})()`
  );
  await waitFor(() =>
    browser.evaluate(`Boolean(document.querySelector('#namedEnvironmentSelect')?.value === 'dev')`)
  );
  await waitFor(() => browser.evaluate(`s.uiActions.doctor.result?.input?.probe === false`), {
    message: 'the selected environment must run local Doctor without a network probe',
  });
  const selectedVersion = await browser.evaluate('s.configuration.payload.version');
  await browser.evaluate('window.__releaseQaSelection()');
  await waitFor(
    () =>
      browser.evaluate(
        `s.configuration.payload.activeConfiguration?.id==='dev'&&!s.configuration.error`
      ),
    { message: 'late environment response must not replace the current selection' }
  );
  await browser.navigate(started.url);
  await waitFor(
    () =>
      browser.evaluate(
        `s.configuration.payload.activeConfiguration?.id==='dev'&&s.configuration.payload.version===${JSON.stringify(selectedVersion)}`
      ),
    { message: 'reload must retain the hash-verified selected environment' }
  );
  await waitFor(
    () =>
      browser.evaluate(
        `Boolean(document.querySelector('#namedEnvironmentSelect')&&document.querySelector('[data-config-probe]'))`
      ),
    {
      message: 'Setup controls did not finish binding after reload',
    }
  );
  await browser.evaluate(`document.querySelector('[data-tab="administration"]')?.click()`);
  await waitFor(() =>
    browser.evaluate(
      `Boolean(document.querySelector('#administration.active #profileWizardSection'))`
    )
  );
  await browser.evaluate(`document.querySelector('[data-tab="configure"]')?.click()`);
  await waitFor(() =>
    browser.evaluate(`Boolean(document.querySelector('#configure.active #namedEnvironmentSelect'))`)
  );
  await browser.setViewport(390, 844);
  assert.equal(
    await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'),
    true,
    'named environment Setup fits a narrow viewport'
  );
  assert.equal(connectionProbeCount, 0, 'named environment selection must not probe a connection');
  await browser.evaluate(`document.querySelector('[data-config-probe]')?.click()`);
  await firstProbeStarted;
  assert.equal(connectionProbeCount, 1, 'explicit connection action runs one bounded probe');
  assert.match(
    await browser.evaluate(`document.querySelector('[data-config-probe]').textContent`),
    /Testing Connections/,
    'the GUI exposes the busy state while the connection check is running'
  );
  releaseFirstProbe();
  await waitFor(
    () => browser.evaluate(`s.uiActions.connections.result?.result?.checks?.[0]?.status==='FAIL'`),
    {
      message: 'connection failure must be visible and retryable',
    }
  );
  await browser.evaluate(`document.querySelector('[data-config-probe]')?.click()`);
  await waitFor(() => connectionProbeCount === 2, {
    message: 'connection retry did not run',
  });
  await waitFor(
    () => browser.evaluate(`s.uiActions.connections.result?.result?.checks?.[0]?.status==='PASS'`),
    {
      message: 'connection retry did not recover',
    }
  );
  await waitFor(() =>
    browser.evaluate(
      `document.body.innerText.includes('Connection check does not grant resource data access.')`
    )
  );
  assert.equal(
    connectionProbeCount,
    2,
    'the selected connection is checked only by the explicit failed attempt and retry'
  );
  await browser.setViewport(390, 560);
  const shortViewport = await browser.evaluate(`({
    width:document.documentElement.scrollWidth,
    height:document.documentElement.scrollHeight,
    viewportWidth:innerWidth,
    viewportHeight:innerHeight
  })`);
  assert.ok(
    shortViewport.width <= shortViewport.viewportWidth,
    'short Setup viewport has no horizontal overflow'
  );
  assert.ok(
    shortViewport.height >= shortViewport.viewportHeight,
    'short Setup viewport remains vertically scrollable'
  );

  const guiActions = await browser.evaluate(`(async () => {
    const waitFor = predicate => new Promise(resolve => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const result = predicate();
        if (result || Date.now() >= deadline) return resolve(Boolean(result));
        setTimeout(check, 25);
      };
      check();
    });

    document.querySelector('[data-tab="home"]')?.click();
    const advancedOpened = await waitFor(() =>
      document.querySelector('#home.active') && document.body.innerText.includes('Advanced / Tools')
    );
    const advancedHasNoDeadButtons =
      document.querySelectorAll('#home button[disabled]').length === 0 &&
      !document.body.innerText.includes('Coming Later');

    document.querySelector('#home [data-home-target="workbench"]')?.click();
    const workbenchOpened = await waitFor(() =>
      document.querySelector('#workbench.active') && document.querySelector('#wbFilter')
    );
    document.querySelector('#workbench [data-wb-select]')?.click();
    const useCaseSelected = await waitFor(() => document.querySelector('#wbPreviewRefresh'));
    document.querySelector('#wbPreviewRefresh')?.click();
    const previewGenerated = await waitFor(() => {
      const pane = document.querySelector('#wbPreviewPane');
      return Boolean(pane && pane.querySelector('pre')?.textContent?.trim());
    });

    document.querySelector('[data-tab="home"]')?.click();
    await waitFor(() => document.querySelector('#home.active'));
    document.querySelector('#home [data-home-target="analyze-workspace"]')?.click();
    const analyzeOpened = await waitFor(() =>
      document.querySelector('#home.active #analyzeProfile') &&
      document.body.innerText.includes('Analyze Workspace')
    );

    const orient = document.querySelector('[data-ai-action="configure"]:not([disabled])');
    orient?.click();
    const aiActionWorked = await waitFor(() => document.querySelector('#configure.active'));

    document.querySelector('[aria-controls="reports"]')?.click();
    const reportsOpened = await waitFor(() => document.querySelector('#artifacts.active'));
    const reportsHaveNoDeadButtons = document.querySelectorAll('#artifacts button[disabled]').length === 0;
    const reportsShowOnlyAvailableViews =
      document.querySelectorAll('#artifacts [data-report-view]').length === 1 &&
      document.querySelector('#artifacts [data-report-view="artifacts"]') !== null;
    document.querySelector('#artifacts [data-reports-target="configure"]')?.click();
    const reportSetupLinkWorked = await waitFor(() => document.querySelector('#configure.active'));

    return {
      advancedOpened,
      advancedHasNoDeadButtons,
      workbenchOpened,
      useCaseSelected,
      previewGenerated,
      analyzeOpened,
      aiActionWorked,
      reportsOpened,
      reportsHaveNoDeadButtons,
      reportsShowOnlyAvailableViews,
      reportSetupLinkWorked
    };
  })()`);
  assert.deepEqual(guiActions, {
    advancedOpened: true,
    advancedHasNoDeadButtons: true,
    workbenchOpened: true,
    useCaseSelected: true,
    previewGenerated: true,
    analyzeOpened: true,
    aiActionWorked: true,
    reportsOpened: true,
    reportsHaveNoDeadButtons: true,
    reportsShowOnlyAvailableViews: true,
    reportSetupLinkWorked: true,
  });

  const reportNavigation = await browser.evaluate(`(async () => {
    const waitForSelection = selector => new Promise(resolve => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const node = document.querySelector(selector);
        if (node?.getAttribute('aria-selected') === 'true' || Date.now() >= deadline) {
          return resolve(node?.getAttribute('aria-selected'));
        }
        setTimeout(check, 25);
      };
      check();
    });
    const reports = document.querySelector('[aria-controls="reports"]');
    reports?.click();
    const selected = await waitForSelection('[aria-controls="reports"]');
    const setup = document.querySelector('[aria-controls="configure"]');
    setup?.click();
    const setupSelected = await waitForSelection('[aria-controls="configure"]');
    return {
      reportSelected: selected,
      setupSelected,
      profileTarget: Boolean(document.querySelector('[data-setup-checklist-target="profileWizardSection"]'))
    };
  })()`);
  assert.equal(reportNavigation.reportSelected, 'true');
  assert.equal(reportNavigation.setupSelected, 'true');
  assert.equal(reportNavigation.profileTarget, true);

  const profileState = await browser.evaluate(
    `fetch('/api/profile-wizard/state').then(response => response.json())`
  );
  assert.equal(profileState.mode, 'local-only-profile-wizard');
  assertNoSensitiveTerms(profileState, ['e2e-private-token']);

  const metadata = await browser.evaluate(
    `fetch('/api/ui-metadata').then(response => response.json())`
  );
  assert.equal(metadata.pluginContracts.summary.total >= 30, true);
  assert.equal(metadata.setupChecklist.tasks.length, 4);
  assertNoSensitiveTerms(metadata, ['e2e-private-token']);

  const contextPreviewUi = await browser.evaluate(`(async () => {
    const button = document.querySelector('[data-context-preview]');
    button?.click();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (document.body.innerText.includes('Preview ready. Review the changes before saving.')) return true;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return false;
  })()`);
  assert.equal(contextPreviewUi, true);

  const workingContext = await browser.evaluate(
    `fetch('/api/ui-context').then(response => response.json())`
  );
  assert.equal(workingContext.kind, 'zeus-working-context');
  assert.equal(workingContext.control.containsCredentials, false);
  assert.equal(Object.prototype.hasOwnProperty.call(workingContext, 'storagePath'), false);
  assertNoSensitiveTerms(workingContext, ['e2e-private-token']);
});

test('browser auto-selects one named environment and runs Doctor without a connection probe', async t => {
  const workspace = createE2eWorkspace('zeus-gui-single-environment-e2e-');
  fs.mkdirSync(workspace.path('config', 'local-only'), { recursive: true });
  fs.writeFileSync(
    workspace.path('config', 'local-only', 'profiles.json'),
    `${JSON.stringify({ dev: { sourceRoot: './source', outputRoot: './output' } }, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    workspace.path('config', 'local-only', 'ui-configurations.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        configurations: [
          {
            id: 'dev',
            label: 'Development',
            profile: 'dev',
            config: 'config/local-only/profiles.json',
          },
        ],
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  const doctorCalls = [];
  let connectionProbes = 0;
  let started;
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (started) await new Promise(resolve => started.server.close(resolve));
    workspace.cleanup();
  });

  try {
    started = await startLocalUiServer({
      outputRoot: workspace.path('output'),
      host: '127.0.0.1',
      port: 0,
      actionServiceOptions: {
        cwd: workspace.root,
        env: {},
        doctorExecutor(args) {
          doctorCalls.push(args);
          return { hasCriticalFailure: false, checks: [], diagnostics: [] };
        },
        connectionCheckServices: {
          db2Query: async () => {
            connectionProbes += 1;
            return { rowCount: 1 };
          },
        },
      },
    });
    browser = await startChrome();
  } catch (error) {
    if (error?.code === 'E2E_PREREQUISITE_MISSING') {
      skipOrFailPrerequisite(t, error.message);
      return;
    }
    throw error;
  }

  await browser.navigate(started.url);
  await waitFor(
    () =>
      browser.evaluate(
        `s.configuration.payload.activeConfiguration?.id==='dev'&&s.uiActions.doctor.result?.input?.probe===false`
      ),
    { message: 'single named environment should auto-select and run local Doctor' }
  );
  assert.equal(doctorCalls.length, 1);
  assert.equal(doctorCalls[0].probe, false);
  assert.equal(connectionProbes, 0);
  assert.equal(
    await browser.evaluate(`document.querySelector('#namedEnvironmentSelect')?.value`),
    'dev'
  );
});

test('real browser can inspect populated reports and complete Workbench actions', async t => {
  const workspace = createE2eWorkspace('zeus-gui-populated-e2e-');
  createPopulatedGuiRun(workspace.path('output'));
  let started;
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (started) await new Promise(resolve => started.server.close(resolve));
    workspace.cleanup();
  });

  try {
    started = await startLocalUiServer({
      outputRoot: workspace.path('output'),
      host: '127.0.0.1',
      port: 0,
      sensitiveTerms: ['e2e-private-token'],
      actionServiceOptions: { cwd: workspace.root, env: {} },
    });
    browser = await startChrome();
  } catch (error) {
    if (error && error.code === 'E2E_PREREQUISITE_MISSING') {
      skipOrFailPrerequisite(t, error.message);
      return;
    }
    throw error;
  }

  await browser.navigate(started.url);
  await browser.evaluate(`new Promise(resolve => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-run]')) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(check, 25);
    };
    check();
  })`);

  const reports = await browser.evaluate(`(async () => {
    const waitFor = predicate => new Promise(resolve => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const result = predicate();
        if (result || Date.now() >= deadline) return resolve(Boolean(result));
        setTimeout(check, 25);
      };
      check();
    });
    const openView = async view => {
      document.querySelector('[aria-controls="reports"]')?.click();
      await waitFor(() => document.querySelector('#artifacts.active'));
      document.querySelector('#artifacts [data-report-view="' + view + '"]')?.click();
      return waitFor(() => document.querySelector('#' + view + '.active'));
    };
    const graphOpened = await openView('graph');
    const graphNode = Boolean(document.querySelector('#graph [data-nid]'));
    document.querySelector('#graph [data-nid]')?.click();
    const db2Opened = await openView('db2');
    const table = Boolean(document.querySelector('#db2 [data-tid]'));
    document.querySelector('#db2 [data-tid]')?.click();
    const promptsOpened = await openView('prompts');
    const promptLoaded = await waitFor(() =>
      document.querySelectorAll('#prompts pre').length === 2 &&
      Array.from(document.querySelectorAll('#prompts pre')).every(node => node.textContent.trim())
    );
    const evidenceOpened = await openView('evidence');
    const evidenceEntry = Boolean(document.querySelector('#evidence [data-evidence-entry]'));
    document.querySelector('#evidence [data-evidence-entry]')?.click();
    const evidenceDetail = await waitFor(() =>
      document.querySelector('#evidence h3')?.textContent?.includes('Why is this known?')
    );
    return { graphOpened, graphNode, db2Opened, table, promptsOpened, promptLoaded, evidenceOpened, evidenceEntry, evidenceDetail };
  })()`);
  assert.deepEqual(reports, {
    graphOpened: true,
    graphNode: true,
    db2Opened: true,
    table: true,
    promptsOpened: true,
    promptLoaded: true,
    evidenceOpened: true,
    evidenceEntry: true,
    evidenceDetail: true,
  });

  const workbench = await browser.evaluate(`(async () => {
    const waitFor = predicate => new Promise(resolve => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const result = predicate();
        if (result || Date.now() >= deadline) return resolve(Boolean(result));
        setTimeout(check, 25);
      };
      check();
    });
    document.querySelector('[data-tab="home"]')?.click();
    await waitFor(() => document.querySelector('#home.active'));
    document.querySelector('#home [data-home-target="workbench"]')?.click();
    await waitFor(() => document.querySelector('#workbench.active #wbPreviewRefresh'));
    document.querySelector('#workbench [data-wb-select]')?.click();
    await waitFor(() => document.querySelector('#wbPreviewRefresh'));
    document.querySelector('#wbPreviewRefresh')?.click();
    const previewReady = await waitFor(() => {
      const text = document.querySelector('#wbPreviewPane pre')?.textContent?.trim() || '';
      return Boolean(text && text !== 'Generating preview...');
    });
    document.querySelector('#wbCopyPreview')?.click();
    const copyFeedback = await waitFor(() =>
      document.body.innerText.includes('Preview copied.') ||
      document.body.innerText.includes('Clipboard unavailable.') ||
      document.body.innerText.includes('Copying preview...')
    );
    document.querySelector('#wbExportPreview')?.click();
    const exportWorked = await waitFor(() => document.body.innerText.includes('Exported '));
    document.querySelector('#wbContextRefresh')?.click();
    const contextRefreshWorked = await waitFor(() => document.body.innerText.includes('Report runs refreshed.'));
    return { previewReady, copyFeedback, exportWorked, contextRefreshWorked };
  })()`);
  assert.deepEqual(workbench, {
    previewReady: true,
    copyFeedback: true,
    exportWorked: true,
    contextRefreshWorked: true,
  });
});
