const test = require('node:test');
const assert = require('node:assert/strict');

const { listConfigUiFields } = require('../src/config/configUiMetadata');
const {
  buildDiscoveryActionPreview,
  buildGuidedConfigurationPayload,
  buildSafeCliPreview,
  classifyIntentAreas,
  getGuidedConfigStep,
  getNextGuidedConfigStepId,
  getPreviousGuidedConfigStepId,
  listGuidedConfigFields,
  validateGuidedConfigurationDraft,
} = require('../src/ui/guidedConfigWizardModel');

test('guided configuration payload exposes wizard steps, intents, purpose labels, and discovery actions', () => {
  const payload = buildGuidedConfigurationPayload({
    configFields: listConfigUiFields({ includeSensitive: true }),
  });

  assert.equal(payload.schemaVersion, 1);
  assert.ok(Array.isArray(payload.steps));
  assert.ok(payload.steps.length >= 7);
  assert.ok(Array.isArray(payload.intents));
  assert.ok(payload.intents.length >= 8);
  assert.ok(Array.isArray(payload.purposeLabels));
  assert.ok(payload.purposeLabels.some((entry) => entry.id === 'rpg-sources'));
  assert.ok(Array.isArray(payload.discoveryActions));
  assert.ok(payload.discoveryActions.some((entry) => entry.id === 'discover-source-libraries'));
  assert.ok(payload.steps.some((step) => step.id === 'source-discovery' && Array.isArray(step.fields) && step.fields.length > 0));
});

test('guided config fields add safety, help, examples, and wizard step hints', () => {
  const enriched = listGuidedConfigFields(listConfigUiFields({ includeSensitive: true }));
  const sourceRoot = enriched.find((entry) => entry.key === 'profile.sourceRoot');
  const sourceFiles = enriched.find((entry) => entry.key === 'profile.fetch.sourceFiles');
  const dbPassword = enriched.find((entry) => entry.key === 'profile.db.password');

  assert.ok(sourceRoot);
  assert.equal(sourceRoot.wizardStepId, 'workspace');
  assert.equal(sourceRoot.safetyLevel, 'S1');
  assert.ok(Array.isArray(sourceRoot.examples));
  assert.ok(sourceRoot.examples.length >= 1);

  assert.ok(sourceFiles);
  assert.equal(sourceFiles.wizardStepId, 'source-discovery');
  assert.equal(sourceFiles.discoveryActionId, 'discover-source-physical-files');

  assert.ok(dbPassword);
  assert.equal(dbPassword.secret, true);
  assert.match(dbPassword.helpText, /environment-variable/i);
});

test('intent classification marks required, recommended, optional, and not-needed areas', () => {
  const classifications = classifyIntentAreas('documentation-generation');
  const workspace = classifications.find((entry) => entry.stepId === 'workspace');
  const dataMetadata = classifications.find((entry) => entry.stepId === 'data-metadata');
  const objectDiscovery = classifications.find((entry) => entry.stepId === 'object-discovery');

  assert.equal(workspace.classification, 'required');
  assert.equal(dataMetadata.classification, 'recommended');
  assert.equal(objectDiscovery.classification, 'not-needed');
  assert.ok(classifications.some((entry) => entry.classification === 'not-needed' || entry.classification === 'optional'));
});

test('guided configuration draft validation enforces known purpose labels and env-only secret references', () => {
  const valid = validateGuidedConfigurationDraft({
    profileName: 'dev',
    intentId: 'onboarding',
    sourceRoot: './workspace/source',
    outputRoot: './workspace/output',
    secretReference: '${env:ZEUS_DB_PASSWORD}',
    sourceLocations: [
      { library: 'applib', sourceFile: 'qrpglesrc', purposeLabel: 'rpg-sources' },
    ],
  });

  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.normalized.sourceLocations[0].library, 'APPLIB');
  assert.equal(valid.normalized.sourceLocations[0].purposeLabel, 'rpg-sources');

  const invalid = validateGuidedConfigurationDraft({
    profileName: 'dev',
    intentId: 'onboarding',
    secretReference: 'super-secret-password',
    sourceLocations: [
      { library: 'applib', sourceFile: 'qrpglesrc', purposeLabel: 'totally-unknown' },
    ],
  });

  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((entry) => /purpose label/i.test(entry)));
  assert.ok(invalid.errors.some((entry) => /environment variables/i.test(entry)));
});

test('safe CLI preview stays secret-free and aligned to the selected intent', () => {
  const preview = buildSafeCliPreview({
    profileName: 'readonly-prod',
    intentId: 'modernization-review',
    sourceRoot: './rpg_sources',
    outputRoot: './output',
    program: 'ORDERPGM',
  });

  assert.equal(preview.intentId, 'modernization-review');
  assert.ok(preview.commands.some((entry) => /workflow --preset modernization-review/.test(entry)));
  assert.ok(preview.commands.every((entry) => !/password|secret|token/i.test(entry)));
  assert.ok(preview.commands.every((entry) => entry.includes('--profile readonly-prod')));
});

test('config-derived discovery preview stays local-only and honest about source scope', () => {
  const preview = buildDiscoveryActionPreview({
    actionId: 'discover-source-physical-files',
    profile: 'dev',
    configContext: {
      sourceLibrary: 'APPLIB',
      sourceFiles: ['qrpglesrc', 'qclsrc'],
      members: ['orderpgm'],
      outputRoot: './rpg_sources',
      matchesDefaultSourceFiles: false,
    },
  });

  assert.equal(preview.status, 'config-preview-ready');
  assert.equal(preview.implemented, true);
  assert.equal(preview.previewKind, 'config-derived-local-preview');
  assert.equal(preview.readOnly, true);
  assert.ok(Array.isArray(preview.candidates));
  assert.equal(preview.candidates[0].value, 'QRPGLESRC');
  assert.equal(preview.resolvedScope.sourceLibrary, 'APPLIB');
  assert.ok(preview.notes.some((entry) => /does not contact IBM i/i.test(entry)));
});

test('DB2 discovery preview can stay local-only while deriving honest metadata scope hints', () => {
  const preview = buildDiscoveryActionPreview({
    actionId: 'discover-db2-tables',
    profile: 'dev',
    configContext: {
      metadataSchema: 'METALIB',
      testDataSchema: 'TESTLIB',
      metadataRoleProfileKey: 'dbRoles.metadata',
      testDataRoleProfileKey: 'dbRoles.testData',
      workflowTables: [
        { schema: 'APP', table: 'ORDERS', filter: 'ORDER%' },
      ],
      allowTables: ['APP.CUSTOMERS'],
      denyTables: ['APP.AUDITLOG'],
      testDataLimit: 25,
      maskColumns: ['EMAIL'],
      maskRuleCount: 1,
    },
  });

  assert.equal(preview.status, 'config-preview-ready');
  assert.equal(preview.implemented, true);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.safetyLevel, 'S2');
  assert.equal(preview.previewKind, 'config-derived-local-preview');
  assert.ok(preview.candidates.some((entry) => entry.kind === 'metadata-schema' && entry.value === 'METALIB'));
  assert.ok(preview.candidates.some((entry) => entry.kind === 'workflow-table' && entry.value === 'APP.ORDERS'));
  assert.equal(preview.resolvedScope.testDataRowLimit, 25);
  assert.ok(Array.isArray(preview.notes));
  assert.ok(preview.notes.some((entry) => /does not contact IBM i or DB2/i.test(entry)));
});

test('object discovery preview can stay local-only while deriving bounded library and member hints', () => {
  const preview = buildDiscoveryActionPreview({
    actionId: 'discover-object-types',
    profile: 'dev',
    configContext: {
      objectLibrary: 'APPLIB',
      sourceFiles: ['QRPGLESRC', 'QSRVSRC'],
      fetchMembers: ['ORDERPGM'],
      workflowMembers: ['CUSTSRV', 'ORDERPGM'],
    },
  });

  assert.equal(preview.status, 'config-preview-ready');
  assert.equal(preview.implemented, true);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.safetyLevel, 'S2');
  assert.equal(preview.previewKind, 'config-derived-local-preview');
  assert.ok(preview.candidates.some((entry) => entry.kind === 'object-library' && entry.value === 'APPLIB'));
  assert.ok(preview.candidates.some((entry) => entry.kind === 'workflow-member' && entry.value === 'CUSTSRV'));
  assert.equal(preview.resolvedScope.workflowMemberCount, 2);
  assert.ok(Array.isArray(preview.notes));
  assert.ok(preview.notes.some((entry) => /does not contact IBM i or DB2/i.test(entry)));
});

test('wizard step navigation stays bounded at first and last steps', () => {
  assert.equal(getGuidedConfigStep('workspace').title.includes('Step 1'), true);
  assert.equal(getPreviousGuidedConfigStepId('workspace'), 'workspace');
  assert.equal(getNextGuidedConfigStepId('workspace'), 'system-profile');
  assert.equal(getNextGuidedConfigStepId('review-save'), 'review-save');
});
