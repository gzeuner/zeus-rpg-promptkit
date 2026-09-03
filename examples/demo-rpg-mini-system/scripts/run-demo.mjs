/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const cli = resolve(root, 'cli', 'zeus.js');
const source = resolve(root, 'examples', 'demo-rpg-mini-system', 'rpg_sources');
const output = resolve(root, 'examples', 'demo-rpg-mini-system', 'output-baseline');

function run(args, { allowFailure = false } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    process.exit(result.status || 1);
  }
}

if (!existsSync(resolve(root, 'node_modules'))) {
  console.error('Missing node_modules. Run: npm install');
  process.exit(2);
}

run(['doctor', '--help'], { allowFailure: true });
run([
  'analyze',
  '--source',
  source,
  '--program',
  'PROGRAM_100',
  '--out',
  output,
  '--mode',
  'documentation',
  '--optimize-context',
  '--safe-sharing',
  '--reproducible',
]);

const cache = resolve(output, '.zeus-cache');
if (existsSync(cache)) rmSync(cache, { recursive: true, force: true });

const investigation = resolve(output, 'PROGRAM_100');
run(
  [
    'investigate',
    '--program',
    'PROGRAM_100',
    '--out',
    output,
    '--goal',
    'Review synthetic demo lineage',
    '--search',
    'ID,STATUS',
  ],
  { allowFailure: true }
);
run(['trace', '--field', 'ID', '--start-program', 'PROGRAM_200', '--source', source], {
  allowFailure: true,
});
run(['xref', '--program', 'PROGRAM_200', '--source', source], { allowFailure: true });
run(['impact', '--target', 'ID', '--program', 'PROGRAM_100', '--out', output, '--source', source], {
  allowFailure: true,
});
run(['assess-risk', '--program', 'PROGRAM_100', '--out', output], { allowFailure: true });
run(['generate-test', '--program', 'PROGRAM_100', '--format', 'markdown', '--out', output], {
  allowFailure: true,
});
run(['generate-checklist', '--program', 'PROGRAM_100', '--out', output], { allowFailure: true });
run(['qa', '--input', investigation, '--format', 'markdown'], { allowFailure: true });
run(
  [
    'bundle',
    '--program',
    'PROGRAM_100',
    '--source-output-root',
    output,
    '--output',
    resolve(output, 'bundle'),
    '--include-json',
    '--include-md',
    '--safe-sharing',
  ],
  { allowFailure: true }
);

console.log('Demo golden path (investigation to review bundle) completed.');
