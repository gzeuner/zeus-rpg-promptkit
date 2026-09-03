const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const {
  WorkingContextWizardError,
  createWorkingContextWizardService,
} = require('../src/ui/workingContextWizardService');

function createFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-working-context-wizard-'));
}

function sourceDraft(overrides = {}) {
  return {
    activeKind: 'sourceCode',
    profile: 'dev',
    resources: {
      sourceCode: {
        profile: 'dev',
        system: 'dev-system',
        library: 'app-lib',
        sourceFile: 'qrpglesrc',
        member: 'orderpgm',
        localRoot: './workspace/source',
        path: './workspace/source/orderpgm.rpgle',
        ifsPath: null,
      },
      objects: {},
      metadata: {},
      data: {},
    },
    ...overrides,
  };
}

test('working context preview is credential-free, local-only, and produces a reviewable diff', () => {
  const cwd = createFixture();
  const service = createWorkingContextWizardService({ cwd });

  const preview = service.previewDraft({ draft: sourceDraft() });

  assert.equal(preview.action, 'working-context-preview');
  assert.equal(preview.status, 'ready');
  assert.equal(preview.current.exists, false);
  assert.equal(preview.proposed.exists, true);
  assert.equal(preview.proposed.active.system, 'DEV-SYSTEM');
  assert.equal(preview.proposed.active.library, 'APP-LIB');
  assert.ok(preview.changes.some(entry => entry.field === 'sourceCode.member'));
  assert.equal(preview.proposed.control.containsCredentials, false);
  assert.equal('storagePath' in preview, false);
  assert.equal(JSON.stringify(preview).includes('PASSWORD'), false);
  assert.equal(fs.existsSync(path.join(cwd, '.zeus', 'working-context.json')), false);
});

test('working context save requires explicit reviewed preview and writes only local routing context', () => {
  const cwd = createFixture();
  const service = createWorkingContextWizardService({ cwd });
  const draft = sourceDraft();
  const preview = service.previewDraft({ draft });

  assert.throws(
    () =>
      service.saveDraft({
        draft,
        baseFingerprint: preview.baseFingerprint,
        previewFingerprint: preview.fingerprint,
      }),
    error =>
      error instanceof WorkingContextWizardError &&
      error.code === 'WORKING_CONTEXT_CONFIRMATION_REQUIRED'
  );

  const saved = service.saveDraft({
    draft,
    confirm: true,
    baseFingerprint: preview.baseFingerprint,
    previewFingerprint: preview.fingerprint,
  });

  assert.equal(saved.action, 'working-context-save');
  assert.equal(saved.status, 'saved');
  assert.equal(saved.context.active.member, 'ORDERPGM');
  assert.equal(saved.context.control.containsCredentials, false);
  assert.equal(saved.storage, '.zeus/working-context.json');
  assert.equal(fs.existsSync(path.join(cwd, '.zeus', 'working-context.json')), true);
  const persisted = JSON.parse(
    fs.readFileSync(path.join(cwd, '.zeus', 'working-context.json'), 'utf8')
  );
  assert.equal(persisted.resources.sourceCode.system, 'DEV-SYSTEM');
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'storagePath'), false);
  assert.equal(JSON.stringify(persisted).includes('PASSWORD'), false);
});

test('working context save fails closed when the reviewed base changed', () => {
  const cwd = createFixture();
  const service = createWorkingContextWizardService({ cwd });
  const draft = sourceDraft();
  const preview = service.previewDraft({ draft });

  service.saveDraft({
    draft,
    confirm: true,
    baseFingerprint: preview.baseFingerprint,
    previewFingerprint: preview.fingerprint,
  });

  const secondPreview = service.previewDraft({
    draft: sourceDraft({ profile: 'changed-profile' }),
  });
  assert.notEqual(secondPreview.baseFingerprint, preview.baseFingerprint);
  assert.throws(
    () =>
      service.saveDraft({
        draft,
        confirm: true,
        baseFingerprint: preview.baseFingerprint,
        previewFingerprint: preview.fingerprint,
      }),
    error => error instanceof WorkingContextWizardError && error.code === 'WORKING_CONTEXT_CONFLICT'
  );
});

test('working context draft rejects unknown fields and oversized values', () => {
  const cwd = createFixture();
  const service = createWorkingContextWizardService({ cwd });

  assert.throws(
    () => service.previewDraft({ draft: { activeKind: 'sourceCode', secret: 'must reject' } }),
    /unsupported field/
  );
  assert.throws(
    () =>
      service.previewDraft({
        draft: sourceDraft({ profile: 'x'.repeat(129) }),
      }),
    /maximum length/
  );
});
