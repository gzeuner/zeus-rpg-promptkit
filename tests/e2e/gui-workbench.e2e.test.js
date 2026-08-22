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
    catalog: Boolean(document.querySelector('#pluginCatalogSection')),
    body: document.body.innerText
  }))()`);
  assert.match(initial.title, /Zeus/i);
  assert.equal(initial.setupTab, 'Setup');
  assert.equal(initial.reportsTab, 'Reports');
  assert.equal(initial.checklistCount, 4);
  assert.equal(initial.catalog, true);
  assertNoSensitiveTerms(initial.body, ['e2e-private-token']);

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
});
