/*
 * Portable GUI E2E using Chrome DevTools Protocol directly. This keeps the
 * production package free of a browser automation dependency while still
 * exercising a real browser against the real local UI server.
 */
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startLocalUiServer } = require('../../src/ui/localUiServer');
const {
  assertNoSensitiveTerms,
  createE2eWorkspace,
  skipOrFailPrerequisite,
} = require('./support/e2eHarness');
const { startChrome } = require('./support/chromeCdp');
const { createPopulatedGuiRun } = require('./support/guiFixture');

test('real browser can operate the secure GUI setup and report navigation', async t => {
  const workspace = createE2eWorkspace('zeus-gui-e2e-');
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
  assertNoSensitiveTerms(initial.body, ['e2e-private-token']);

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

    document.querySelector('[aria-controls="home"]')?.click();
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

    document.querySelector('[aria-controls="home"]')?.click();
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
    document.querySelector('[aria-controls="home"]')?.click();
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
