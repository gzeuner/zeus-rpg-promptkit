const test = require('node:test');
const assert = require('node:assert/strict');

const { validateCompileTemplateRequest } = require('../src/bridge/bridgeCompileGuard');

const enabledCompileConfig = {
  compile: {
    enabled: true,
    allowedTemplates: ['crtbndrpg', 'crtrpgmod'],
  },
};

test('validateCompileTemplateRequest refuses arbitrary command text', () => {
  assert.throws(
    () =>
      validateCompileTemplateRequest({
        templateId: 'crtbndrpg',
        commandText: 'CRTBNDRPG PGM(APPLIB/ORDERPGM)',
        bridgeConfig: enabledCompileConfig,
      }),
    /Arbitrary compile command text is not allowed/
  );
});

test('validateCompileTemplateRequest accepts known allowlisted template id', () => {
  const templateId = validateCompileTemplateRequest({
    templateId: 'crtrpgmod',
    commandText: '',
    bridgeConfig: enabledCompileConfig,
  });
  assert.equal(templateId, 'crtrpgmod');
});
