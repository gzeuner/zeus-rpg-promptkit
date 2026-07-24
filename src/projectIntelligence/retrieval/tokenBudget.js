'use strict';

const { estimateTokens } = require('../../ai/tokenEstimator');
const { BUDGET_WEIGHTS, DEFAULT_TOKEN_BUDGET } = require('./constants');
const { fail, REASON_CODES } = require('../store/errors');

function normalizeTokenBudget(tokenBudget) {
  if (tokenBudget == null) return DEFAULT_TOKEN_BUDGET;
  const n = Number(tokenBudget);
  if (!Number.isFinite(n) || n <= 0) {
    fail(REASON_CODES.SCHEMA_INVALID, 'tokenBudget must be a positive number');
  }
  return Math.floor(n);
}

/**
 * Allocate integer token slices that sum to totalBudget.
 */
function allocateBudgetSlices(tokenBudget) {
  const total = normalizeTokenBudget(tokenBudget);
  const entries = Object.entries(BUDGET_WEIGHTS);
  const raw = entries.map(([name, w]) => ({ name, exact: total * w }));
  const floors = raw.map(r => ({ name: r.name, tokens: Math.floor(r.exact), frac: r.exact % 1 }));
  let used = floors.reduce((s, r) => s + r.tokens, 0);
  let remainder = total - used;
  // Distribute remainder by largest fractional part (deterministic name tie-break)
  const byFrac = [...floors].sort((a, b) => {
    if (b.frac !== a.frac) return b.frac - a.frac;
    return a.name.localeCompare(b.name);
  });
  for (const row of byFrac) {
    if (remainder <= 0) break;
    row.tokens += 1;
    remainder -= 1;
  }
  const slices = {};
  for (const row of floors) slices[row.name] = row.tokens;
  return { total, slices };
}

function estimateItemTokens(item) {
  if (item == null) return 0;
  if (typeof item === 'string') return estimateTokens(item);
  if (typeof item.tokenEstimate === 'number') return Math.max(0, Math.floor(item.tokenEstimate));
  const payload = {
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    text: item.text,
    name: item.name,
  };
  return estimateTokens(JSON.stringify(payload));
}

/**
 * Greedy pack items under a bucket budget. Returns selected + omitted with reasons.
 * Items must be pre-sorted in priority order (deterministic).
 */
function packBucket(items, budgetTokens, reasonCodeWhenOmitted) {
  const selected = [];
  const omitted = [];
  let used = 0;
  for (const item of items || []) {
    const cost = estimateItemTokens(item);
    if (used + cost <= budgetTokens || (selected.length === 0 && cost <= budgetTokens)) {
      // Allow first item only if it fits; if single item exceeds budget, omit with report
      if (used + cost > budgetTokens && selected.length > 0) {
        omitted.push({
          entityId: item.id,
          kind: item.kind,
          reasonCode: reasonCodeWhenOmitted,
          description: 'Excluded by token budget',
          tokenEstimate: cost,
        });
        continue;
      }
      if (cost > budgetTokens && selected.length === 0) {
        omitted.push({
          entityId: item.id,
          kind: item.kind,
          reasonCode: reasonCodeWhenOmitted,
          description: 'Item exceeds bucket token budget',
          tokenEstimate: cost,
        });
        continue;
      }
      selected.push({ ...item, tokenEstimate: cost });
      used += cost;
    } else {
      omitted.push({
        entityId: item.id,
        kind: item.kind,
        reasonCode: reasonCodeWhenOmitted,
        description: 'Excluded by token budget',
        tokenEstimate: cost,
      });
    }
  }
  return { selected, omitted, usedTokens: used, budgetTokens };
}

module.exports = {
  normalizeTokenBudget,
  allocateBudgetSlices,
  estimateItemTokens,
  packBucket,
  estimateTokens,
};
