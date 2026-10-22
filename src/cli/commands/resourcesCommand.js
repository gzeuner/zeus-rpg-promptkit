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
'use strict';

const { renderAsciiTable } = require('../helpers/asciiTable');
const { resolveProfileResources } = require('../../config/runtimeConfig');
const { RESOURCE_KINDS } = require('../../config/resourceModel');
const { createJsonOutput } = require('../helpers/jsonOutput');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createInterface } = require('node:readline/promises');
const { sanitizeValue, collectSensitiveTermsFromEnv } = require('../../security/secretMasking');
const {
  discoverResources,
  prepareResourceJob,
  collectResourceJob,
} = require('../../core/resourceDiscoveryService');

function printResourceDiscovery(result) {
  console.log('Resources: local discovery only; no remote connection or approval.');
  if (!result.configuration) {
    console.log(result.failureCode || result.status);
    return;
  }
  if (result.configuration.candidates) {
    for (const candidate of result.configuration.candidates)
      console.log(`  ${candidate.exists ? 'Available' : 'Missing'}: ${candidate.path}`);
    console.log(`Optional explicit base: ${result.configuration.baseCandidate}`);
    console.log(
      'Select --config and ordered --env-files explicitly; no file was selected automatically.'
    );
    return;
  }
  console.log(`Files: ${result.configuration.configSources.join(' + ')}`);
  const rows = result.profiles.flatMap(discoveryRows);
  console.log(renderAsciiTable(['Profile', 'Resource', 'Target', 'Local Scope / Status'], rows));
  for (const profile of result.profiles) printDiscoveryNotes(profile);
  console.log(
    'Next: resources --wizard with the same explicit files; choose exact selectors and preview the job.'
  );
}

function discoveryRows(profile) {
  if (!profile.resources.length)
    return [
      [profile.name, profile.mode, '-', profile.warning || profile.failureCode || profile.status],
    ];
  return profile.resources.map(resource => [
    profile.name,
    resource.ref,
    resource.target,
    `${resource.enabled ? resource.readiness.localValidation : 'disabled'}; ${JSON.stringify(resource.scope)}`,
  ]);
}

function printDiscoveryNotes(profile) {
  if (profile.replacement) console.log(`${profile.name}: prefer ${profile.replacement}.`);
  for (const resource of profile.resources)
    if (resource.missingEnv.length)
      console.log(
        `${profile.name}/${resource.ref}: missing env references: ${resource.missingEnv.join(', ')}`
      );
}

async function runResourceWizard(args) {
  if (args.selection) {
    if (typeof args.selection !== 'string' || !path.isAbsolute(args.selection))
      throw Object.assign(new Error('RESOURCE_SELECTION_FILE_INVALID'), {
        code: 'RESOURCE_SELECTION_FILE_INVALID',
      });
    const stat = fs.lstatSync(args.selection);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      throw Object.assign(new Error('RESOURCE_SELECTION_FILE_INVALID'), {
        code: 'RESOURCE_SELECTION_FILE_INVALID',
      });
    return prepareResourceJob(args, JSON.parse(fs.readFileSync(args.selection, 'utf8')));
  }
  if (args.json || !process.stdin.isTTY)
    throw Object.assign(new Error('RESOURCE_WIZARD_INPUT_REQUIRED'), {
      code: 'RESOURCE_WIZARD_INPUT_REQUIRED',
    });
  printResourceDiscovery(discoverResources(args));
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  terminal.once('close', () => controller.abort());
  try {
    return await collectResourceJob(args, {
      ask: prompt => terminal.question(prompt, { signal: controller.signal }),
    });
  } finally {
    terminal.close();
  }
}

async function runDiscoveryAction(args) {
  try {
    if (
      (args.discover && args.wizard) ||
      args.execute ||
      args['approve-plan'] ||
      args.job ||
      args.investigation
    )
      throw Object.assign(new Error('RESOURCE_ACTION_CONFLICT'), {
        code: 'RESOURCE_ACTION_CONFLICT',
      });
    const result = args.wizard ? await runResourceWizard(args) : discoverResources(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else if (args.wizard) {
      console.log(`Job: ${result.jobPath || 'not saved; add --out <workspace-relative-job.json>'}`);
      console.log(JSON.stringify(result.plan, null, 2));
      console.log(
        'Planned only. Use --execute to review and confirm this job in an interactive terminal; no access has started.'
      );
    } else printResourceDiscovery(result);
  } catch (error) {
    console.log(
      JSON.stringify({
        status: 'blocked',
        code: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'RESOURCE_DISCOVERY_FAILED',
        remoteMutation: false,
      })
    );
    process.exitCode = 2;
  }
}

const KIND_TITLES = Object.freeze({
  sourceCode: 'Source code',
  objects: 'Objects',
  metadata: 'DB metadata',
  data: 'DB data',
});

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return '(none)';
  }
  return values.join(', ');
}

function buildResourceRows(model) {
  const rows = [];
  for (const kind of RESOURCE_KINDS) {
    const resource = model.resources[kind] || {};
    const scopeParts = [];
    if (Array.isArray(resource.libraries) && resource.libraries.length > 0) {
      scopeParts.push(`libraries=${resource.libraries.join(',')}`);
    }
    if (Array.isArray(resource.sourceFiles) && resource.sourceFiles.length > 0) {
      scopeParts.push(`sourceFiles=${resource.sourceFiles.join(',')}`);
    }
    if (Array.isArray(resource.members) && resource.members.length > 0) {
      scopeParts.push(`members=${resource.members.join(',')}`);
    }
    if (Array.isArray(resource.ifsPaths) && resource.ifsPaths.length > 0) {
      scopeParts.push(`ifsPaths=${resource.ifsPaths.join(',')}`);
    }
    if (Array.isArray(resource.objectTypes) && resource.objectTypes.length > 0) {
      scopeParts.push(`objectTypes=${resource.objectTypes.join(',')}`);
    }
    if (Array.isArray(resource.schemas) && resource.schemas.length > 0) {
      scopeParts.push(`schemas=${resource.schemas.join(',')}`);
    }
    rows.push([
      KIND_TITLES[kind] || kind,
      resource.system || '(default)',
      resource.target && resource.target.host ? resource.target.host : '(unconfigured)',
      scopeParts.length > 0 ? scopeParts.join('; ') : '(none)',
    ]);
  }
  return rows;
}

async function requestResourceApproval(
  plan,
  { input = process.stdin, output = process.stdout, selects = [] } = {}
) {
  if (!input.isTTY)
    throw Object.assign(new Error('RESOURCE_PLAN_APPROVAL_REQUIRED'), {
      code: 'RESOURCE_PLAN_APPROVAL_REQUIRED',
    });
  const investigation = plan.schemaVersion === 'resource-investigation/v1';
  const review = sanitizeValue(
    investigation
      ? {
          purpose: plan.purpose,
          sessionId: plan.sessionId,
          operatorId: plan.operatorId,
          limits: plan.limits,
          expiresAt: plan.expiresAt,
          output: plan.output,
          operations: plan.operations,
          selects,
          remoteMutation: false,
        }
      : {
          goal: plan.goal,
          profile: plan.profile,
          configSources: plan.configSources,
          envFiles: plan.envFiles,
          dataAccess: plan.dataAccess,
          remoteMutation: plan.remoteMutation,
          localArtifactWrite: plan.localArtifactWrite,
          operations: plan.operations,
        },
    { sensitiveTerms: collectSensitiveTermsFromEnv(process.env) }
  );
  output.write(`Review read-only job before remote access:\n${JSON.stringify(review, null, 2)}\n`);
  const terminal = createInterface({ input, output });
  const controller = new AbortController();
  terminal.once('close', () => controller.abort());
  try {
    const answer = await terminal.question(
      investigation
        ? 'Approve this bounded read-only investigation? [yes/NO]: '
        : 'Approve this exact read-only job? [yes/NO]: ',
      {
        signal: controller.signal,
      }
    );
    return /^(yes|ja)$/i.test(answer.trim());
  } finally {
    terminal.close();
  }
}

function readInvestigationInput(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file))
    throw Object.assign(new Error('INVESTIGATION_INPUT_INVALID'), {
      code: 'INVESTIGATION_INPUT_INVALID',
    });
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw Object.assign(new Error('INVESTIGATION_INPUT_INVALID'), {
      code: 'INVESTIGATION_INPUT_INVALID',
    });
  const bytes = fs.readFileSync(file);
  if (bytes.length > 1024 * 1024)
    throw Object.assign(new Error('INVESTIGATION_INPUT_INVALID'), {
      code: 'INVESTIGATION_INPUT_INVALID',
    });
  let spec;
  try {
    spec = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw Object.assign(new Error('INVESTIGATION_INPUT_INVALID'), {
      code: 'INVESTIGATION_INPUT_INVALID',
    });
  }
  return { spec, hash: createHash('sha256').update(bytes).digest('hex') };
}

async function runResourceInvestigation(args) {
  const { loadResourceJob } = require('../../config/resourceAccessPlan');
  const {
    planResourceInvestigation,
    openResourceInvestigation,
    buildSelect,
  } = require('../../core/resourceInvestigationService');
  if (
    args['approve-plan'] ||
    typeof args.investigation !== 'string' ||
    !path.isAbsolute(args.investigation)
  )
    throw Object.assign(new Error('INVESTIGATION_INPUT_INVALID'), {
      code: 'INVESTIGATION_INPUT_INVALID',
    });
  const { spec, hash: selectionHash } = readInvestigationInput(args.investigation);
  if (
    spec.schemaVersion !== 1 ||
    Object.keys(spec).some(
      key => !['schemaVersion', 'operatorId', 'limits', 'selects'].includes(key)
    ) ||
    !Array.isArray(spec.selects) ||
    !spec.selects.length ||
    spec.selects.length > 100
  )
    throw Object.assign(new Error('INVESTIGATION_INPUT_INVALID'), {
      code: 'INVESTIGATION_INPUT_INVALID',
    });
  const { plan } = loadResourceJob(args);
  const reviewed = planResourceInvestigation({
    plan,
    sessionId: randomUUID(),
    operatorId: spec.operatorId,
    limits: spec.limits,
    selectionHash,
  });
  for (const request of spec.selects) {
    const operation = plan.operations.find(entry => entry.ref === request.ref);
    if (!operation)
      throw Object.assign(new Error('INVESTIGATION_SCOPE_DENIED'), {
        code: 'INVESTIGATION_SCOPE_DENIED',
      });
    buildSelect(request, operation);
  }
  if (
    spec.selects.length > spec.limits.queries ||
    spec.selects.reduce((sum, request) => sum + request.maxRows, 0) > spec.limits.rows
  )
    throw Object.assign(new Error('INVESTIGATION_BUDGET_EXHAUSTED'), {
      code: 'INVESTIGATION_BUDGET_EXHAUSTED',
    });
  if (!args.execute) {
    const { approvalHash, ...publicReview } = reviewed;
    return {
      ...publicReview,
      status: 'planned',
      requestCount: spec.selects.length,
      grantExportable: false,
    };
  }
  if (args.json || !process.stdin.isTTY)
    throw Object.assign(new Error('INVESTIGATION_INTERACTIVE_APPROVAL_REQUIRED'), {
      code: 'INVESTIGATION_INTERACTIVE_APPROVAL_REQUIRED',
    });
  if (!(await requestResourceApproval(reviewed, { selects: spec.selects })))
    throw Object.assign(new Error('INVESTIGATION_APPROVAL_DECLINED'), {
      code: 'INVESTIGATION_APPROVAL_DECLINED',
    });
  const session = openResourceInvestigation({
    reviewed,
    approve: reviewed.approvalHash,
    loadPlan: () => loadResourceJob(args).plan,
    loadSelection: () => readInvestigationInput(args.investigation).hash,
    audit: event => {
      process.stderr.write(`${JSON.stringify(event)}\n`);
    },
  });
  const evidence = [];
  try {
    for (const request of spec.selects) evidence.push(await session.select(request));
    return { ...session.summary(), status: 'completed', remoteMutation: false, evidence };
  } finally {
    session.revoke();
  }
}

async function runResourceJob(args) {
  try {
    if (args.investigation) {
      console.log(JSON.stringify(await runResourceInvestigation(args), null, 2));
      return;
    }
    const {
      loadResourceJob,
      executeResourceJob,
      confirmAndExecuteResourceJob,
    } = require('../../core/resourceAccessService');
    if (args.execute === true && !args['approve-plan']) {
      if (args.json || !process.stdin.isTTY)
        throw Object.assign(new Error('RESOURCE_PLAN_APPROVAL_REQUIRED'), {
          code: 'RESOURCE_PLAN_APPROVAL_REQUIRED',
        });
      const result = await confirmAndExecuteResourceJob({ args, confirm: requestResourceApproval });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const { plan, envFiles, baseConfig } = loadResourceJob(args);
    const result =
      args.execute === true
        ? await executeResourceJob({
            plan,
            approve: args['approve-plan'],
            loadPlan: () => loadResourceJob(args).plan,
          })
        : { ...plan, envFiles, baseConfig, status: 'planned' };
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(
      JSON.stringify({
        status: 'blocked',
        code: error.code && /^[A-Z_]+$/.test(error.code) ? error.code : 'RESOURCE_JOB_FAILED',
        remoteMutation: false,
      })
    );
    process.exitCode = 2;
  }
}

async function runResources(args) {
  if (args.discover || args.wizard) return runDiscoveryAction(args);
  if (args.job || args.investigation) return runResourceJob(args);
  if (!args.profile || !String(args.profile).trim()) {
    console.error('Missing required option: --profile <name>');
    process.exit(2);
  }

  let result;
  try {
    result = resolveProfileResources(args, { cwd: process.cwd(), env: process.env });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const { model } = result;

  const json = createJsonOutput(args);
  if (json.isJsonMode) {
    json.print(result);
    return;
  }

  console.log(`Profile: ${result.profile}`);
  console.log(`Configuration: ${result.configSource}`);
  console.log(`Multi-system: ${model.multiSystem ? 'yes' : 'no'}`);
  if (Array.isArray(model.systems) && model.systems.length > 0) {
    console.log(
      `Systems: ${model.systems.map(s => `${s.key}${s.host ? ` (${s.host})` : ''}`).join(', ')}`
    );
  }
  if (!model.hasExplicitResources) {
    console.log(
      'Note: no explicit "resources" block — model derived from fetch/db/dbRoles (backward compatible).'
    );
  }
  console.log('');
  console.log(renderAsciiTable(['Resource', 'System', 'Host', 'Scope'], buildResourceRows(model)));
}

module.exports = {
  runResources,
  buildResourceRows,
  printResourceDiscovery,
  requestResourceApproval,
};
