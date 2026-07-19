'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const {
  buildOutputBundle,
  BUNDLE_MANIFEST_SCHEMA_VERSION,
} = require('../src/bundle/outputBundleBuilder');

function installedAdmZipVersion() {
  const pkgPath = require.resolve('adm-zip/package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

/**
 * Craft a single-entry ZIP that declares a huge uncompressed size while carrying
 * only a few payload bytes (CVE-2026-39244 / GHSA-xcpc-8h2w-3j85 regression shape).
 */
function craftDeclaredSizeBomb(declaredSize, method, content) {
  const name = Buffer.from('a');
  const crc = 0;
  const lfh = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(method),
    u16(0),
    u16(0),
    u32(crc),
    u32(content.length),
    u32(declaredSize),
    u16(name.length),
    u16(0),
    name,
    content,
  ]);
  const cd = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(method),
    u16(0),
    u16(0),
    u32(crc),
    u32(content.length),
    u32(declaredSize),
    u16(name.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    name,
  ]);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(cd.length),
    u32(lfh.length),
    u16(0),
  ]);
  return Buffer.concat([lfh, cd, eocd]);
}

function createTempBundleProject(program = 'ORDERPGM') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-adm-zip-sec-'));
  const outputRoot = path.join(tempRoot, 'output');
  const bundleRoot = path.join(tempRoot, 'bundles');
  const programOutputDir = path.join(outputRoot, program);
  fs.mkdirSync(programOutputDir, { recursive: true });
  return { tempRoot, outputRoot, bundleRoot, programOutputDir, program };
}

test('installed adm-zip satisfies the GHSA-xcpc-8h2w-3j85 patched range', () => {
  const version = installedAdmZipVersion();
  const [major, minor] = version.split('.').map(part => Number(part));
  assert.ok(major > 0 || (major === 0 && minor >= 6), `expected adm-zip >= 0.6.0, got ${version}`);
  assert.equal(require('../package.json').dependencies['adm-zip'], '^0.6.0');
});

test('CVE-2026-39244: crafted STORED bomb does not allocate declared size', () => {
  const DECLARED = 3 * 1024 * 1024 * 1024;
  const zip = new AdmZip(craftDeclaredSizeBomb(DECLARED, 0, Buffer.from('A')));
  const before = process.memoryUsage().rss;
  assert.throws(() => zip.getEntries()[0].getData(), /CRC|crc|BAD/i);
  const grewMB = (process.memoryUsage().rss - before) / (1024 * 1024);
  assert.ok(grewMB < 256, `RSS grew ${grewMB.toFixed(1)} MB; allocation must stay bounded`);
});

test('CVE-2026-39244: crafted DEFLATED bomb does not allocate declared size', () => {
  const DECLARED = 3 * 1024 * 1024 * 1024;
  const zip = new AdmZip(craftDeclaredSizeBomb(DECLARED, 8, Buffer.from([0x00])));
  const before = process.memoryUsage().rss;
  assert.throws(() => zip.getEntries()[0].getData());
  const grewMB = (process.memoryUsage().rss - before) / (1024 * 1024);
  assert.ok(grewMB < 256, `RSS grew ${grewMB.toFixed(1)} MB; allocation must stay bounded`);
});

test('empty archive and truncated archive fail closed for entry data access', () => {
  const empty = new AdmZip();
  assert.deepEqual(empty.getEntries(), []);

  assert.throws(() => {
    // truncated local header / missing EOCD
    const broken = new AdmZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
    void broken;
  });
});

test('round-trip multi-entry archive preserves nested relative paths and content', () => {
  const zip = new AdmZip();
  zip.addFile('root.txt', Buffer.from('root\n', 'utf8'));
  zip.addFile('nested/dir/file.txt', Buffer.from('nested\n', 'utf8'));
  zip.addFile('safe-sharing/report.md', Buffer.from('# report\n', 'utf8'));
  const buf = zip.toBuffer();
  const round = new AdmZip(buf);
  const names = round
    .getEntries()
    .filter(entry => !entry.isDirectory)
    .map(entry => entry.entryName)
    .sort();
  assert.deepEqual(names, ['nested/dir/file.txt', 'root.txt', 'safe-sharing/report.md']);
  assert.equal(round.readAsText('nested/dir/file.txt'), 'nested\n');
});

test('entry names with traversal, absolute, and windows drive forms remain names only', () => {
  const zip = new AdmZip();
  zip.addFile('../escape.txt', Buffer.from('no\n', 'utf8'));
  zip.addFile('..\\win-escape.txt', Buffer.from('no\n', 'utf8'));
  zip.addFile('/abs/path.txt', Buffer.from('no\n', 'utf8'));
  zip.addFile('C:/windows/system32/evil.txt', Buffer.from('no\n', 'utf8'));
  zip.addFile('C:\\windows\\system32\\evil2.txt', Buffer.from('no\n', 'utf8'));
  const names = zip.getEntries().map(entry => entry.entryName);
  assert.ok(names.some(name => name.includes('escape') || name.includes('evil')));
  // Production Zeus never extractAllTo untrusted archives; assert we still only hold names.
  for (const entry of zip.getEntries()) {
    assert.equal(typeof entry.entryName, 'string');
    assert.ok(Buffer.isBuffer(entry.getData()));
  }
});

test('duplicate entry names remain readable without silent merge of content', () => {
  const zip = new AdmZip();
  zip.addFile('dup.txt', Buffer.from('first', 'utf8'));
  zip.addFile('dup.txt', Buffer.from('second', 'utf8'));
  const matches = zip.getEntries().filter(entry => entry.entryName === 'dup.txt');
  assert.ok(matches.length >= 1);
  const data = zip.readAsText('dup.txt');
  assert.ok(data === 'first' || data === 'second');
});

test('buildOutputBundle still writes stable multi-file zip with manifest checksums', () => {
  const { tempRoot, outputRoot, bundleRoot, programOutputDir, program } = createTempBundleProject();
  try {
    fs.writeFileSync(path.join(programOutputDir, 'context.json'), '{"program":"ORDERPGM"}\n');
    fs.writeFileSync(path.join(programOutputDir, 'report.md'), '# Report\n');
    fs.writeFileSync(
      path.join(programOutputDir, 'analyze-run-manifest.json'),
      `${JSON.stringify(
        {
          run: { status: 'succeeded', completedAt: '2026-03-16T10:00:00.000Z' },
          inputs: {
            sourceSnapshot: { fingerprint: 'abc123' },
          },
          artifacts: [{ path: 'context.json' }, { path: 'report.md' }],
        },
        null,
        2
      )}\n`
    );

    const result = buildOutputBundle({
      program,
      sourceOutputRoot: outputRoot,
      bundleOutputRoot: bundleRoot,
      reproducibility: {
        enabled: true,
        timestamp: '2026-03-16T10:00:00.000Z',
      },
    });

    assert.equal(result.manifest.schemaVersion, BUNDLE_MANIFEST_SCHEMA_VERSION);
    assert.ok(fs.existsSync(result.zipPath));
    const zip = new AdmZip(result.zipPath);
    const entryNames = zip
      .getEntries()
      .map(entry => entry.entryName)
      .sort();
    assert.deepEqual(entryNames, [
      'README.txt',
      'analyze-run-manifest.json',
      'context.json',
      'manifest.json',
      'report.md',
    ]);
    for (const artifact of result.manifest.artifacts) {
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isFinite(artifact.sizeBytes));
    }
    const manifestEntry = zip.getEntry('manifest.json');
    assert.ok(manifestEntry);
    const inside = JSON.parse(manifestEntry.getData().toString('utf8'));
    assert.equal(inside.program, 'ORDERPGM');
    assert.equal(inside.summary.totalFiles, result.manifest.summary.totalFiles);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('production bundle API does not extract archives to the workspace', () => {
  const source = fs.readFileSync(require.resolve('../src/bundle/outputBundleBuilder.js'), 'utf8');
  assert.equal(source.includes('extractAllTo'), false);
  assert.equal(source.includes('extractEntryTo'), false);
  assert.match(source, /new AdmZip\(\)/);
  assert.match(source, /writeZip/);
  assert.match(source, /addFile/);
});
