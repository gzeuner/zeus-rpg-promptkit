const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createTemplate,
  deleteTemplate,
  listTemplates,
  normalizeTemplateStorePath,
  readTemplate,
  readTemplateStore,
  updateTemplate,
} = require('../src/ui/promptWorkbenchTemplateStore');

test('template store supports CRUD and validation boundaries', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-template-store-'));
  const storePath = normalizeTemplateStorePath('', tempRoot);

  try {
    assert.equal(
      storePath.endsWith(path.join('config', 'local-only', 'prompt-workbench', 'templates.json')),
      true
    );
    assert.deepEqual(readTemplateStore(storePath), {
      schemaVersion: 1,
      templates: [],
    });

    const created = createTemplate(storePath, {
      name: 'Prompt Canvas Baseline',
      description: 'Initial template',
      useCaseId: 'documentation-generation',
      moduleIds: ['system-role', 'toolset-context'],
      fields: {
        goal: 'Document architecture and API changes.',
      },
      additionalRequirements: 'Keep existing routes backward compatible.',
      tags: ['mvp', 'docs'],
    });

    assert.equal(typeof created.id, 'string');
    assert.equal(created.name, 'Prompt Canvas Baseline');
    assert.deepEqual(created.moduleIds, ['system-role', 'toolset-context']);

    const listed = listTemplates(storePath);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.id);

    const updated = updateTemplate(storePath, created.id, {
      name: 'Prompt Canvas Baseline v2',
      description: 'Updated template',
      useCaseId: 'documentation-generation',
      moduleIds: ['system-role', 'toolset-context', 'output-contract'],
      fields: {
        goal: 'Document architecture, API contracts, and tests.',
      },
      additionalRequirements: 'Explicitly call out regressions.',
      tags: ['mvp', 'docs', 'tests'],
    });

    assert.equal(updated.id, created.id);
    assert.equal(updated.name, 'Prompt Canvas Baseline v2');
    assert.deepEqual(updated.moduleIds, ['system-role', 'toolset-context', 'output-contract']);

    const loaded = readTemplate(storePath, created.id);
    assert.equal(loaded.name, 'Prompt Canvas Baseline v2');

    const deleted = deleteTemplate(storePath, created.id);
    assert.equal(deleted.id, created.id);
    assert.deepEqual(listTemplates(storePath), []);

    assert.throws(
      () =>
        createTemplate(storePath, {
          name: '',
          useCaseId: 'documentation-generation',
          moduleIds: ['system-role'],
        }),
      /name is required/i
    );

    assert.throws(
      () =>
        createTemplate(storePath, {
          name: 'Invalid Modules',
          useCaseId: 'documentation-generation',
          moduleIds: [],
        }),
      /at least one moduleid/i
    );

    assert.throws(() => readTemplate(storePath, 'missing-template-id'), /not found/i);
    assert.throws(
      () =>
        updateTemplate(storePath, 'missing-template-id', {
          name: 'x',
          useCaseId: 'documentation-generation',
          moduleIds: ['system-role'],
        }),
      /not found/i
    );
    assert.throws(() => deleteTemplate(storePath, 'missing-template-id'), /not found/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
