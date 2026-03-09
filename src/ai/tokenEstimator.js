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
