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
function clampNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return number;
}

function estimateTokens(text, options = {}) {
  const charsPerToken = clampNumber(options.charsPerToken, 4);
  const normalized = String(text || '');
  if (!normalized) return 0;
  return Math.ceil(normalized.length / charsPerToken);
}

function estimateTokensFromObject(value, options = {}) {
  return estimateTokens(JSON.stringify(value), options);
}

function computeReduction(originalTokens, optimizedTokens) {
  const original = Math.max(0, Number(originalTokens) || 0);
  const optimized = Math.max(0, Number(optimizedTokens) || 0);
  if (original <= 0) {
    return 0;
  }
  const reduction = ((original - optimized) / original) * 100;
  return Math.max(0, Math.round(reduction));
}

module.exports = {
  estimateTokens,
  estimateTokensFromObject,
  computeReduction,
};
