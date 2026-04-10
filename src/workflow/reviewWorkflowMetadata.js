/*
Copyright 2026 Guido Zeuner

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
function normalizeStrings(values) {
  return Object.freeze((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean));
}

function normalizeOutputEntries(entries) {
  return Object.freeze((Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      path: String(entry && entry.path || '').trim(),
      purpose: String(entry && entry.purpose || '').trim(),
    }))
    .filter((entry) => entry.path && entry.purpose)
    .map((entry) => Object.freeze(entry)));
}

function freezeReviewWorkflow(reviewWorkflow) {
  if (!reviewWorkflow || typeof reviewWorkflow !== 'object') {
    return null;
  }

  return Object.freeze({
    intendedAudience: normalizeStrings(reviewWorkflow.intendedAudience),
    keyQuestionsAnswered: normalizeStrings(reviewWorkflow.keyQuestionsAnswered),
    expectedDecisions: normalizeStrings(reviewWorkflow.expectedDecisions),
    interpretationGuidance: normalizeStrings(reviewWorkflow.interpretationGuidance),
    requiredInputs: normalizeStrings(reviewWorkflow.requiredInputs),
    recommendedOutputs: normalizeOutputEntries(reviewWorkflow.recommendedOutputs),
  });
}

function cloneReviewWorkflow(reviewWorkflow) {
  if (!reviewWorkflow || typeof reviewWorkflow !== 'object') {
    return null;
  }

  return {
    intendedAudience: [...(reviewWorkflow.intendedAudience || [])],
    keyQuestionsAnswered: [...(reviewWorkflow.keyQuestionsAnswered || [])],
    expectedDecisions: [...(reviewWorkflow.expectedDecisions || [])],
    interpretationGuidance: [...(reviewWorkflow.interpretationGuidance || [])],
    requiredInputs: [...(reviewWorkflow.requiredInputs || [])],
    recommendedOutputs: (reviewWorkflow.recommendedOutputs || []).map((entry) => ({
      path: entry.path,
      purpose: entry.purpose,
    })),
  };
}

module.exports = {
  cloneReviewWorkflow,
  freezeReviewWorkflow,
};
