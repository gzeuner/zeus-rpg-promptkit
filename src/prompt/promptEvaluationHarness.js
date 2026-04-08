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
const fs = require('fs');
const path = require('path');
const { renderPrompt, validatePromptApplicability } = require('./promptBuilder');

function loadPromptEvaluationFixture(fixturePath) {
  const resolved = path.resolve(fixturePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function evaluatePromptFixture(fixturePath) {
  const fixture = loadPromptEvaluationFixture(fixturePath);
  const input = fixture.input || {};
  const evaluations = Array.isArray(fixture.evaluations) ? fixture.evaluations : [];

  return evaluations.map((evaluation) => {
    const templateName = evaluation.template;
    const applicability = validatePromptApplicability(templateName, input);
    if (!applicability.applicable) {
      return {
        template: templateName,
        ok: false,
        failures: applicability.failures,
        estimatedTokens: 0,
        content: '',
      };
    }

    try {
      const rendered = renderPrompt(templateName, input);
      const failures = [];
      for (const snippet of evaluation.mustInclude || []) {
        if (!rendered.content.includes(String(snippet))) {
          failures.push(`Missing required text: ${snippet}`);
        }
      }
      for (const regexText of evaluation.mustMatch || []) {
        const regex = new RegExp(regexText, 'm');
        if (!regex.test(rendered.content)) {
          failures.push(`Missing required pattern: ${regexText}`);
        }
      }
      return {
        template: templateName,
        ok: failures.length === 0,
        failures,
        estimatedTokens: rendered.estimatedTokens,
        content: rendered.content,
      };
    } catch (error) {
      return {
        template: templateName,
        ok: false,
        failures: [error.message],
        estimatedTokens: 0,
        content: '',
      };
    }
  });
}

module.exports = {
  evaluatePromptFixture,
  loadPromptEvaluationFixture,
};
