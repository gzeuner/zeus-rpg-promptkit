/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  buildEvidenceExplorer,
  buildRoleProfileMetadata,
  buildWorkflowRunCard,
} = require('../src/ui/guiWorkbenchContracts');

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('workflow run card exposes a safe, evidence-first next action', () => {
  const card = buildWorkflowRunCard({
    summary: {
      program: 'ORDERPGM',
      status: 'completed',
      sourceRoot: './source',
      artifactCount: 2,
      workflowRunAvailable: true,
    },
    evidence: {
      overallStatus: 'changed',
      summary: { total: 2 },
    },
  });

  assert.equal(card.status, 'completed');
  assert.equal(card.steps.length, 4);
  assert.equal(card.nextBestAction.target, 'evidence');
  assert.equal(card.nextBestAction.safety, 'S0');
  assert.equal(card.repeatable, true);
  assert.equal(card.scope.sourceRoot, './source');
});

test('evidence explorer distinguishes fresh, changed, missing, and unverified files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-gui-evidence-'));
  const sourceRoot = path.join(root, 'source');
  const outputRoot = path.join(root, 'output');
  fs.mkdirSync(path.join(sourceRoot, 'QRPGLESRC'), { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'QRPGLESRC', 'ORDERPGM.rpgle'), 'source-current', 'utf8');
  fs.writeFileSync(path.join(outputRoot, 'report.md'), 'report-current', 'utf8');
  fs.writeFileSync(path.join(outputRoot, 'unverified.md'), 'x', 'utf8');

  const explorer = buildEvidenceExplorer({
    program: 'ORDERPGM',
    programOutputDir: outputRoot,
    artifacts: [
      { path: 'report.md', kind: 'markdown', sizeBytes: 14 },
      { path: 'removed.json', kind: 'json', sizeBytes: 2 },
      { path: 'unverified.md', kind: 'markdown', sizeBytes: 1 },
    ],
    analyzeManifest: {
      run: { completedAt: '2026-08-21T10:00:00.000Z' },
      artifacts: [
        { path: 'report.md', sizeBytes: 14, sha256: hash('report-current') },
        { path: 'removed.json', sizeBytes: 2, sha256: hash('removed') },
        { path: 'unverified.md', sizeBytes: 1, sha256: 'not-a-sha256' },
      ],
      inputs: {
        sourceSnapshot: {
          root: sourceRoot,
          fileCount: 1,
          files: [
            {
              path: 'QRPGLESRC/ORDERPGM.rpgle',
              sizeBytes: 14,
              sha256: hash('source-recorded'),
            },
          ],
        },
      },
    },
  });

  try {
    assert.equal(explorer.overallStatus, 'changed');
    assert.deepEqual(explorer.summary, {
      total: 4,
      fresh: 1,
      changed: 1,
      missing: 1,
      unverified: 1,
      sourceCount: 1,
      artifactCount: 3,
    });
    assert.ok(explorer.entries.every(entry => !path.isAbsolute(entry.path)));
    assert.ok(explorer.entries.every(entry => !Object.hasOwn(entry, 'content')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('role profile metadata is local-only and credential-free', () => {
  const metadata = buildRoleProfileMetadata();
  assert.equal(metadata.localOnly, true);
  assert.equal(metadata.profiles.length, 4);
  assert.deepEqual(
    metadata.profiles.map(profile => profile.id),
    ['developer', 'architect', 'tester', 'product-owner']
  );
  assert.match(metadata.secretHandling, /credentials/i);
  assert.ok(metadata.profiles.every(profile => !Object.hasOwn(profile, 'password')));
});
