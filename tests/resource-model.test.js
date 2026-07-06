const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveResourceModel,
  deriveLegacyResources,
  RESOURCE_KINDS,
} = require('../src/config/resourceModel');
const {
  loadProfiles,
  resolveProfile,
  resolveProfileResources,
  validateProfiles,
} = require('../src/config/runtimeConfig');

function createTempProject(profiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-resource-model-'));
  fs.mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, 'config', 'profiles.example.json'),
    `${JSON.stringify(profiles, null, 2)}\n`,
    'utf8',
  );
  return tempRoot;
}

test('resolveResourceModel exposes the four canonical resource kinds', () => {
  const model = resolveResourceModel({});
  assert.equal(model.kind, 'resource-model');
  assert.equal(model.schemaVersion, 1);
  for (const kind of RESOURCE_KINDS) {
    assert.ok(model.resources[kind], `missing resource kind ${kind}`);
    assert.equal(model.resources[kind].kind, kind);
  }
  assert.deepEqual(RESOURCE_KINDS, ['sourceCode', 'objects', 'metadata', 'data']);
});

test('deriveLegacyResources maps fetch and dbRoles into resource scopes', () => {
  const profile = {
    fetch: {
      sourceLib: 'devlib',
      files: ['QRPGLESRC', 'qddssrc'],
      members: ['ORDERPGM'],
      ifsDir: '/home/dev/src',
    },
    db: { defaultLibrary: 'APPDATA' },
    dbRoles: {
      metadata: { defaultSchema: 'APPMETA', schemaPreference: ['SHARED'] },
      testData: { defaultSchema: 'APPDATA' },
    },
  };
  const derived = deriveLegacyResources(profile);
  assert.deepEqual(derived.sourceCode.libraries, ['DEVLIB']);
  assert.deepEqual(derived.sourceCode.sourceFiles, ['QRPGLESRC', 'QDDSSRC']);
  assert.deepEqual(derived.sourceCode.members, ['ORDERPGM']);
  assert.deepEqual(derived.sourceCode.ifsPaths, ['/home/dev/src']);
  assert.deepEqual(derived.objects.libraries, ['APPDATA', 'DEVLIB']);
  assert.deepEqual(derived.metadata.schemas, ['APPMETA', 'SHARED']);
  assert.deepEqual(derived.data.schemas, ['APPDATA']);
});

test('resolveResourceModel keeps single-system profiles working without a resources block', () => {
  const profile = {
    fetch: { sourceLib: 'DEVLIB', files: ['QRPGLESRC'] },
    dbRoles: { metadata: { defaultSchema: 'APPMETA' }, testData: { defaultSchema: 'APPDATA' } },
  };
  const model = resolveResourceModel(profile);
  assert.equal(model.hasExplicitResources, false);
  assert.deepEqual(model.resources.sourceCode.sourceFiles, ['QRPGLESRC']);
  assert.deepEqual(model.resources.metadata.schemas, ['APPMETA']);
  assert.deepEqual(model.resources.data.schemas, ['APPDATA']);
});

test('resolveResourceModel resolves explicit per-system resources across multiple systems', () => {
  const tempRoot = createTempProject({
    multi: {
      systems: {
        test: { host: 'test.example.local', systemName: 'SYSTEST', displayName: 'Test System' },
        prod: { host: 'prod.example.local', systemName: 'SYSPROD', displayName: 'Prod System' },
      },
      resources: {
        sourceCode: { system: 'test', libraries: ['srclib'], sourceFiles: ['QRPGLESRC', 'QCLLESRC'], members: ['custsrv'] },
        objects: { system: 'test', libraries: ['objlib'], objectTypes: ['*PGM', '*SRVPGM'] },
        metadata: { system: 'prod', schemas: ['catalog'] },
        data: { system: 'prod', schemas: ['appdata'] },
      },
    },
  });
  try {
    const profiles = loadProfiles({ cwd: tempRoot, env: {} });
    const resolved = resolveProfile(profiles, 'multi', { env: {} });
    const model = resolveResourceModel(resolved, { env: {} });

    assert.equal(model.hasExplicitResources, true);
    assert.equal(model.multiSystem, true);

    assert.equal(model.resources.sourceCode.system, 'test');
    assert.deepEqual(model.resources.sourceCode.libraries, ['SRCLIB']);
    assert.deepEqual(model.resources.sourceCode.sourceFiles, ['QRPGLESRC', 'QCLLESRC']);
    assert.deepEqual(model.resources.sourceCode.members, ['CUSTSRV']);
    assert.equal(model.resources.sourceCode.target.host.toLowerCase(), 'test.example.local');

    assert.equal(model.resources.objects.system, 'test');
    assert.deepEqual(model.resources.objects.objectTypes, ['*PGM', '*SRVPGM']);

    assert.equal(model.resources.metadata.system, 'prod');
    assert.deepEqual(model.resources.metadata.schemas, ['CATALOG']);
    assert.equal(model.resources.metadata.target.host.toLowerCase(), 'prod.example.local');

    assert.equal(model.resources.data.system, 'prod');
    assert.deepEqual(model.resources.data.schemas, ['APPDATA']);

    assert.deepEqual(model.systemsInUse, ['prod', 'test']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('system-level resource defaults are inherited and overridden by profile resources', () => {
  const profile = {
    systems: {
      test: {
        host: 'test.example.local',
        systemName: 'SYSTEST',
        resources: {
          sourceCode: { sourceFiles: ['QRPGLESRC', 'QDDSSRC'], libraries: ['BASELIB'] },
        },
      },
    },
    resources: {
      sourceCode: { system: 'test', libraries: ['OVERRIDELIB'] },
    },
  };
  const model = resolveResourceModel(profile);
  // libraries overridden at profile level, sourceFiles inherited from system defaults
  assert.deepEqual(model.resources.sourceCode.libraries, ['OVERRIDELIB']);
  assert.deepEqual(model.resources.sourceCode.sourceFiles, ['QRPGLESRC', 'QDDSSRC']);
});

test('resolveProfileResources facade returns sanitized model without secrets', () => {
  const tempRoot = createTempProject({
    secure: {
      systems: {
        test: { host: 'test.example.local', user: 'SECRETUSER', password: 'SECRETPW', systemName: 'SYSTEST' },
      },
      resources: {
        sourceCode: { system: 'test', libraries: ['SRCLIB'], sourceFiles: ['QRPGLESRC'] },
      },
    },
  });
  try {
    const result = resolveProfileResources({ profile: 'secure' }, { cwd: tempRoot, env: {} });
    const serialized = JSON.stringify(result.model);
    assert.equal(result.profile, 'secure');
    assert.doesNotMatch(serialized, /SECRETPW/);
    assert.doesNotMatch(serialized, /SECRETUSER/);
    assert.match(serialized, /test\.example\.local/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveProfileResources requires a profile name', () => {
  assert.throws(() => resolveProfileResources({}, { env: {} }), /profile name is required/i);
});

test('validateProfiles rejects unsupported resource kinds', () => {
  assert.throws(
    () => validateProfiles({ sample: { resources: { bogus: {} } } }),
    /not a supported resource kind/i,
  );
});

test('validateProfiles rejects unsupported fields for a resource kind', () => {
  assert.throws(
    () => validateProfiles({ sample: { resources: { metadata: { libraries: ['X'] } } } }),
    /not supported for resource kind "metadata"/i,
  );
});

test('validateProfiles accepts a well-formed resources block', () => {
  assert.doesNotThrow(() => validateProfiles({
    sample: {
      resources: {
        system: 'test',
        sourceCode: { system: 'test', libraries: ['SRCLIB'], sourceFiles: ['QRPGLESRC'], members: ['PGM'], ifsPaths: ['/a'] },
        objects: { libraries: ['OBJLIB'], objectTypes: ['*PGM'] },
        metadata: { schemas: ['META'] },
        data: { schemas: ['DATA'] },
      },
    },
  }));
});
