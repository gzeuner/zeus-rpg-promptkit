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

const CONTRACT_IDS = require('./contractIds');

/**
 * Basic header validator used by all initial shells.
 * Requires a numeric schemaVersion that matches the registered version.
 */
function basicHeaderValidator(expectedVersion) {
  return value => {
    const errors = [];
    if (value == null || typeof value !== 'object') {
      errors.push({ path: '', message: 'expected an object' });
      return errors;
    }
    const sv = value.schemaVersion;
    if (sv === undefined) {
      errors.push({ path: '/schemaVersion', message: 'schemaVersion is required' });
    } else if (Number(sv) !== expectedVersion) {
      errors.push({
        path: '/schemaVersion',
        message: `expected ${expectedVersion}, got ${sv}`,
      });
    }
    return errors;
  };
}

/**
 * Validator for typed evidence-graph v1.
 * This is the foundation schema. Nodes and edges carry provenance, confidence,
 * locations and uncertainty. Extra fields are tolerated for additive evolution.
 */
function evidenceGraphSchema(value) {
  const errors = basicHeaderValidator(1)(value);
  if (!value || typeof value !== 'object') return errors;

  if (typeof value.kind !== 'string' || value.kind !== 'evidence-graph') {
    errors.push({ path: '/kind', message: 'kind must be "evidence-graph"' });
  }
  if (typeof value.program !== 'string' || !value.program) {
    errors.push({ path: '/program', message: 'program is required' });
  }
  if (!Array.isArray(value.nodes)) {
    errors.push({ path: '/nodes', message: 'nodes must be an array' });
  } else {
    value.nodes.forEach((node, i) => {
      if (!node || typeof node !== 'object') {
        errors.push({ path: `/nodes/${i}`, message: 'node must be object' });
        return;
      }
      if (typeof node.id !== 'string' || !node.id) {
        errors.push({ path: `/nodes/${i}/id`, message: 'id required' });
      }
      const allowedNodeTypes = [
        'PROGRAM',
        'PROCEDURE',
        'SUBROUTINE',
        'SOURCE_MEMBER',
        'COPYBOOK',
        'INCLUDE',
        'FILE',
        'TABLE',
        'FIELD',
        'UNRESOLVED_SYMBOL',
      ];
      if (node.type && !allowedNodeTypes.includes(String(node.type))) {
        errors.push({ path: `/nodes/${i}/type`, message: 'unrecognized node type' });
      }
      if (node.confidence && typeof node.confidence !== 'string') {
        errors.push({ path: `/nodes/${i}/confidence`, message: 'confidence must be string' });
      }
      if (node.provenance && typeof node.provenance !== 'object') {
        errors.push({ path: `/nodes/${i}/provenance`, message: 'provenance must be object' });
      }
      if (node.locations && !Array.isArray(node.locations)) {
        errors.push({ path: `/nodes/${i}/locations`, message: 'locations must be array' });
      }
    });
  }
  if (!Array.isArray(value.edges)) {
    errors.push({ path: '/edges', message: 'edges must be an array' });
  } else {
    const allowedEdgeTypes = [
      'PROGRAM_CALL',
      'BOUND_PROCEDURE_CALL',
      'SUBROUTINE_CALL',
      'COPY_INCLUDE',
      'FILE_READ',
      'FILE_WRITE',
      'TABLE_REFERENCE',
      'FIELD_REFERENCE',
      'TRIGGER_DEPENDENCY',
      'VIEW_DEPENDENCY',
      'BINDING_CANDIDATE',
      'DYNAMIC_UNRESOLVED_CALL',
    ];
    value.edges.forEach((edge, i) => {
      if (!edge || typeof edge !== 'object') {
        errors.push({ path: `/edges/${i}`, message: 'edge must be object' });
        return;
      }
      if (typeof edge.from !== 'string' || !edge.from) {
        errors.push({ path: `/edges/${i}/from`, message: 'from required' });
      }
      if (typeof edge.to !== 'string' || !edge.to) {
        errors.push({ path: `/edges/${i}/to`, message: 'to required' });
      }
      if (edge.type && !allowedEdgeTypes.includes(String(edge.type))) {
        errors.push({ path: `/edges/${i}/type`, message: 'unrecognized edge type' });
      }
      if (edge.confidence && typeof edge.confidence !== 'string') {
        errors.push({ path: `/edges/${i}/confidence`, message: 'confidence must be string' });
      }
    });
  }
  return errors;
}

/**
 * Validator for context-plan/v1 (graph-guided evidence planning).
 * Captures goal, targets, budget, selected evidence with reasons/paths,
 * omissions, unresolved relationships, and confidence.
 */
function contextPlanSchema(value) {
  const errors = basicHeaderValidator(1)(value);
  if (!value || typeof value !== 'object') return errors;

  if (typeof value.kind !== 'string' || value.kind !== 'context-plan') {
    errors.push({ path: '/kind', message: 'kind must be "context-plan"' });
  }
  if (typeof value.goal !== 'string' || !value.goal.trim()) {
    errors.push({ path: '/goal', message: 'goal is required' });
  }
  if (typeof value.tokenBudget !== 'number' || value.tokenBudget <= 0) {
    errors.push({ path: '/tokenBudget', message: 'positive tokenBudget is required' });
  }
  if (!Array.isArray(value.selected)) {
    errors.push({ path: '/selected', message: 'selected must be an array' });
  } else {
    value.selected.forEach((item, i) => {
      if (!item || typeof item !== 'object') {
        errors.push({ path: `/selected/${i}`, message: 'selected item must be object' });
        return;
      }
      if (typeof item.id !== 'string' || !item.id) {
        errors.push({ path: `/selected/${i}/id`, message: 'id required' });
      }
      if (!Array.isArray(item.reasons)) {
        errors.push({ path: `/selected/${i}/reasons`, message: 'reasons array required' });
      }
      if (item.graphPath && !Array.isArray(item.graphPath)) {
        errors.push({
          path: `/selected/${i}/graphPath`,
          message: 'graphPath must be array if present',
        });
      }
      if (item.confidence && typeof item.confidence !== 'string') {
        errors.push({ path: `/selected/${i}/confidence`, message: 'confidence must be string' });
      }
      if (item.location && typeof item.location !== 'object') {
        errors.push({ path: `/selected/${i}/location`, message: 'location must be object' });
      }
    });
  }
  if (value.omissions && !Array.isArray(value.omissions)) {
    errors.push({ path: '/omissions', message: 'omissions must be array if present' });
  }
  if (value.unresolved && !Array.isArray(value.unresolved)) {
    errors.push({ path: '/unresolved', message: 'unresolved must be array if present' });
  }
  return errors;
}

/**
 * Metadata-only shells for the contracts introduced in package 02.
 * These only enforce common header/identity fields for now.
 * Full structural schemas will be added by later packages.
 */

const evidenceModelSchema = basicHeaderValidator(1);

const runManifestSchema = value => {
  const errors = basicHeaderValidator(1)(value);
  if (value && typeof value === 'object') {
    if (!value.tool || typeof value.tool !== 'object') {
      errors.push({ path: '/tool', message: 'tool metadata object is required' });
    }
    if (typeof value.run !== 'object' || value.run === null) {
      errors.push({ path: '/run', message: 'run object is required' });
    }
    if (Array.isArray(value.artifacts)) {
      value.artifacts.forEach((a, i) => {
        if (a && typeof a.path === 'string' && (a.path.startsWith('/') || a.path.includes('..'))) {
          errors.push({
            path: `/artifacts/${i}/path`,
            message: 'artifact path must be relative and safe',
          });
        }
      });
    }
  }
  return errors;
};

const artifactReferenceSchema = value => {
  const errors = basicHeaderValidator(1)(value);
  if (value && typeof value === 'object') {
    if (typeof value.path !== 'string' || !value.path) {
      errors.push({ path: '/path', message: 'path is required and must be a string' });
    }
    if (value.path && (value.path.startsWith('/') || value.path.includes('..'))) {
      errors.push({
        path: '/path',
        message: 'path must be relative and safe (no absolute or traversal)',
      });
    }
  }
  return errors;
};

const investigationSessionSchema = value => {
  const errors = basicHeaderValidator(1)(value);
  if (!value || typeof value !== 'object') return errors;

  if (typeof value.id !== 'string' || !value.id) {
    errors.push({ path: '/id', message: 'id is required' });
  }
  if (typeof value.goal !== 'string') {
    errors.push({ path: '/goal', message: 'goal must be a string' });
  }
  if (!value.focus || typeof value.focus !== 'object') {
    errors.push({ path: '/focus', message: 'focus object is required' });
  }
  if (!Array.isArray(value.history)) {
    errors.push({ path: '/history', message: 'history must be an array' });
  }
  // Evidence vs interpretation separation hint (future strict)
  if (value.evidence && !Array.isArray(value.evidence)) {
    errors.push({ path: '/evidence', message: 'evidence should be an array if present' });
  }
  if (value.findings && !Array.isArray(value.findings)) {
    errors.push({ path: '/findings', message: 'findings should be an array if present' });
  }
  return errors;
};

const safetyPolicySchema = value => {
  const errors = basicHeaderValidator(1)(value);
  if (value && typeof value === 'object' && value.level != null) {
    const level = String(value.level);
    if (!['S0', 'S1', 'S2', 'S3', 'S4'].includes(level)) {
      errors.push({ path: '/level', message: 'level must be one of S0-S4' });
    }
  }
  return errors;
};

const { PROVIDER_SCHEMAS } = require('../../providers/contracts');
const { GENERATION_SCHEMAS } = require('../../generationValidation/contracts');
const { moduleDescriptorSchema } = require('../../modules/descriptor');

function moduleStatusSchema(value) {
  const errors = basicHeaderValidator(1)(value);
  if (!value || typeof value !== 'object') return errors;
  if (value.kind != null && value.kind !== 'module-status') {
    errors.push({ path: '/kind', message: 'kind must be "module-status" when present' });
  }
  if (typeof value.lifecycle !== 'string' || !value.lifecycle) {
    errors.push({ path: '/lifecycle', message: 'lifecycle is required' });
  }
  if (typeof value.availability !== 'string' || !value.availability) {
    errors.push({ path: '/availability', message: 'availability is required' });
  }
  if (typeof value.reasonCode !== 'string' || !value.reasonCode) {
    errors.push({ path: '/reasonCode', message: 'reasonCode is required' });
  }
  if (value.coreEnforcesEntitlement !== false && value.coreEnforcesEntitlement != null) {
    errors.push({
      path: '/coreEnforcesEntitlement',
      message: 'coreEnforcesEntitlement must be false when present',
    });
  }
  return errors;
}

const INITIAL_SCHEMAS = Object.freeze({
  [CONTRACT_IDS.EVIDENCE_MODEL]: { version: 1, schema: evidenceModelSchema },
  [CONTRACT_IDS.EVIDENCE_GRAPH]: { version: 1, schema: evidenceGraphSchema },
  [CONTRACT_IDS.CONTEXT_PLAN]: { version: 1, schema: contextPlanSchema },
  [CONTRACT_IDS.RUN_MANIFEST]: { version: 1, schema: runManifestSchema },
  [CONTRACT_IDS.ARTIFACT_REFERENCE]: { version: 1, schema: artifactReferenceSchema },
  [CONTRACT_IDS.INVESTIGATION_SESSION]: { version: 1, schema: investigationSessionSchema },
  [CONTRACT_IDS.SAFETY_POLICY]: { version: 1, schema: safetyPolicySchema },
  ...PROVIDER_SCHEMAS,
  ...GENERATION_SCHEMAS,
  [CONTRACT_IDS.MODULE_DESCRIPTOR]: { version: 1, schema: moduleDescriptorSchema },
  [CONTRACT_IDS.MODULE_STATUS]: { version: 1, schema: moduleStatusSchema },
});

module.exports = {
  CONTRACT_IDS,
  INITIAL_SCHEMAS,
  basicHeaderValidator,
};
