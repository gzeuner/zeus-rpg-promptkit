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

/**
 * Stable contract identifiers for Zeus domain schemas.
 * These IDs are intended to be long-lived. Major version changes signal breaking changes.
 */
module.exports = Object.freeze({
  EVIDENCE_MODEL: 'zeus.evidence-model',
  EVIDENCE_GRAPH: 'zeus.evidence-graph',
  CONTEXT_PLAN: 'zeus.context-plan',
  RUN_MANIFEST: 'zeus.run-manifest',
  ARTIFACT_REFERENCE: 'zeus.artifact-reference',
  INVESTIGATION_SESSION: 'zeus.investigation-session',
  SAFETY_POLICY: 'zeus.safety-policy',
});
