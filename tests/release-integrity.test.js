'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const workflowPath =
  process.env.RELEASE_WORKFLOW_PATH || path.join(ROOT, '.github', 'workflows', 'release.yml');
const notesPath =
  process.env.BETA2_NOTES_PATH || path.join(ROOT, '.github', 'RELEASE_NOTES_v0.2.0-beta.2.md');
const policyPath =
  process.env.RELEASE_POLICY_PATH || path.join(ROOT, 'docs', 'maintainers', 'release-integrity.md');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const notes = fs.readFileSync(notesPath, 'utf8');
const policy = fs.readFileSync(policyPath, 'utf8');

function job(name) {
  const marker = new RegExp(`^ {2}${name}:\\s*$`, 'm');
  const match = marker.exec(workflow);
  assert.ok(match, `missing workflow job ${name}`);
  const tail = workflow.slice(match.index + match[0].length);
  const next = /^ {2}[a-zA-Z][a-zA-Z0-9-]*:\s*$/m.exec(tail);
  return next ? tail.slice(0, next.index) : tail;
}

function occurrences(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

test('required attestation verification has no shell failure suppression', () => {
  const section = job('attest');
  assert.doesNotMatch(section, /\|\|\s*(?:true|echo)\b/);
});

test('release jobs do not use continue-on-error', () => {
  assert.doesNotMatch(workflow, /continue-on-error\s*:/);
});

test('publication depends on successful attestation', () => {
  assert.match(job('publish'), /needs:\s*\[build, attest\]/);
});

test('tag creation is confined to the post-attestation publish job', () => {
  assert.equal(occurrences(workflow, /^\s+git tag /gm), 1);
  assert.match(job('publish'), /git tag "\$TAG" "\$SOURCE_SHA"/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('  publish:')), /^\s+git tag /m);
});

test('release creation occurs after tag creation', () => {
  const section = job('publish');
  assert.ok(section.indexOf('git tag "$TAG"') < section.indexOf('gh release create "$TAG"'));
});

test('the release tarball is built exactly once', () => {
  assert.equal(occurrences(workflow, /\bnpm pack --json\b/g), 1);
});

test('platform verification and later jobs never rebuild the tarball', () => {
  for (const name of [
    'verify-linux-20',
    'verify-linux-lts',
    'verify-windows-20',
    'attest',
    'publish',
    'verify-published',
  ]) {
    assert.doesNotMatch(job(name), /\bnpm pack\b/, name);
  }
});

test('all platform jobs consume the same captured workflow artifact', () => {
  for (const name of ['verify-linux-20', 'verify-linux-lts', 'verify-windows-20']) {
    assert.match(job(name), /name: \$\{\{ needs\.build\.outputs\.artifact_name \}\}/, name);
  }
});

test('source SHA is captured once from github.sha and exported', () => {
  const section = job('build');
  assert.equal(occurrences(section, /SOURCE_SHA="\$GITHUB_SHA"/g), 1);
  assert.match(section, /source_sha=\$SOURCE_SHA/);
});

test('the tag target is the captured source SHA', () => {
  const section = job('publish');
  assert.match(section, /SOURCE_SHA: \$\{\{ needs\.build\.outputs\.source_sha \}\}/);
  assert.match(section, /git tag "\$TAG" "\$SOURCE_SHA"/);
  assert.match(section, /--target "\$SOURCE_SHA"/);
});

test('package and both lockfile versions are checked', () => {
  const section = job('build');
  assert.match(section, /require\('\.\/package\.json'\)\.version/);
  assert.match(section, /require\('\.\/package-lock\.json'\)\.version/);
  assert.match(section, /packages\[''\]\.version/);
});

test('checksums are generated and reverified', () => {
  assert.match(job('build'), /sha256sum "\$TARBALL" "\$SBOM" > SHA256SUMS/);
  assert.ok(occurrences(workflow, /sha256sum --check SHA256SUMS/g) >= 5);
});

test('the CycloneDX SBOM is generated and version-validated', () => {
  const section = job('build');
  assert.match(section, /npm sbom --sbom-format cyclonedx --omit=dev/);
  assert.match(section, /validate-sbom\.js "\$SBOM" "\$RELEASE_VERSION"/);
});

test('attestation subject is the exact captured tarball', () => {
  assert.match(
    job('attest'),
    /subject-path: release-artifacts\/\$\{\{ needs\.build\.outputs\.tarball \}\}/
  );
});

test('canonical verification binds the expected repository', () => {
  assert.match(job('attest'), /gh attestation verify "\$TARBALL"/);
  assert.match(job('attest'), /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(job('attest'), /--signer-repo "\$GITHUB_REPOSITORY"/);
});

test('canonical verification binds the expected signer workflow', () => {
  assert.match(
    job('attest'),
    /--signer-workflow "\$GITHUB_REPOSITORY\/\.github\/workflows\/release\.yml"/
  );
});

test('attestation propagation retries are fixed and bounded', () => {
  const section = job('attest');
  assert.match(section, /MAX_ATTEMPTS=5/);
  assert.match(section, /RETRY_SECONDS=10/);
  assert.match(section, /seq 1 "\$MAX_ATTEMPTS"/);
  assert.match(section, /if \[ "\$ATTEMPT" -eq "\$MAX_ATTEMPTS" \]/);
});

test('authentication and permission failures stop without retry', () => {
  const section = job('attest');
  assert.match(section, /HTTP \(401\|403\).*authentication.*permission.*forbidden.*unauthorized/i);
  assert.ok(section.indexOf("grep -Eqi 'HTTP") < section.indexOf('sleep "$RETRY_SECONDS"'));
});

test('attestation write permission exists only in the attestation job', () => {
  assert.equal(occurrences(workflow, /attestations: write/g), 1);
  assert.match(job('attest'), /attestations: write/);
});

test('OIDC write permission exists only in the attestation job', () => {
  assert.equal(occurrences(workflow, /id-token: write/g), 1);
  assert.match(job('attest'), /id-token: write/);
});

test('publication has contents write but no attestation permissions', () => {
  const section = job('publish');
  assert.match(section, /contents: write/);
  assert.doesNotMatch(section, /attestations:|id-token:/);
});

test('every GitHub Action reference is immutable', () => {
  const refs = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(match => match[1]);
  assert.ok(refs.length >= 10);
  for (const ref of refs) assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, ref);
});

test('generic release workflow contains no hard-coded Beta 2 version', () => {
  assert.doesNotMatch(workflow, /0\.2\.0-beta\.2/);
});

test('existing tags are rejected and lookup failures fail closed', () => {
  const section = job('build');
  assert.match(section, /tag v\$\{REQUESTED_VERSION\} already exists/);
  assert.match(section, /unable to determine whether the release tag exists/);
});

test('existing releases are rejected and lookup failures fail closed', () => {
  const section = job('build');
  assert.match(section, /release v\$\{REQUESTED_VERSION\} already exists/);
  assert.match(section, /unable to determine whether the release exists/);
});

test('versioned release notes travel with the artifact to publication', () => {
  assert.match(
    job('build'),
    /cp "\.github\/RELEASE_NOTES_v\$\{RELEASE_VERSION\}\.md" RELEASE_NOTES\.md/
  );
  assert.match(job('build'), /^\s+RELEASE_NOTES\.md$/m);
  assert.match(job('publish'), /--notes-file release-artifacts\/RELEASE_NOTES\.md/);
});

test('historical policy records exact Beta 2 exception evidence', () => {
  for (const expected of [
    'ACCEPTED HISTORICAL EXCEPTION',
    '6b0786becbb3d9044acc3b8628557fbb1a2c2f66',
    '7345100964ed43166224e3b67847b036817554e5',
    'a14ffe303bc7158a2c0144e3d2a8e422b9301331175bd617b7364251a7f223ea',
    'f137b52ddc61ae4bae60484a0777028d73631094629f8bdd583a2909628b7a40',
    'No retroactive attestation will be created',
    'No future\\s+release may use this exception',
  ])
    assert.match(policy, new RegExp(expected, 'i'));
});

test('Beta 2 public notes do not claim canonical attestation is available', () => {
  assert.doesNotMatch(notes, /gh attestation verify/);
  assert.match(notes, /no build-provenance\s+attestation is claimed/i);
  assert.match(notes, /tag and release assets remain\s+unchanged/i);
});

test('no retroactive Beta 2 attestation repair workflow exists', () => {
  assert.equal(
    fs.existsSync(path.join(ROOT, '.github', 'workflows', 'repair-beta2-attestation.yml')),
    false
  );
});

test('published package excludes repository workflows and retains runtime assets', () => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const [result] = JSON.parse(output);
  const files = new Set(result.files.map(entry => entry.path));
  assert.equal(
    [...files].some(file => file.startsWith('.github/')),
    false
  );
  for (const required of [
    'cli/zeus.js',
    'src/api/zeusApi.js',
    'java/Db2DiagnosticQueryRunner.java',
    'schemas/README.md',
    'config/.env.example',
    'config/profiles.example.json',
  ])
    assert.ok(files.has(required), `missing packaged runtime asset ${required}`);
});

test('CI permanently runs the focused release-integrity suite', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /npm run test:release-integrity/);
});

test('captured source must remain current main immediately before tagging', () => {
  const section = job('publish');
  assert.match(section, /git fetch origin main --tags --prune/);
  assert.match(section, /test "\$\(git rev-parse origin\/main\)" = "\$SOURCE_SHA"/);
});

test('final verification uses a fresh release download and attested digest', () => {
  const section = job('verify-published');
  assert.match(section, /gh release download "\$TAG"/);
  assert.match(section, /ATTESTED_DIGEST: \$\{\{ needs\.attest\.outputs\.subject_digest \}\}/);
  assert.match(section, /sha256:\$\(sha256sum "\$TARBALL"/);
});
