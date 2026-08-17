'use strict';

/**
 * Handwritten deterministic CHECK / manual expression lexer + parser.
 * Never uses eval, Function, or dynamic code execution.
 *
 * Supported:
 *   =  <>  <  <=  >  >=  BETWEEN  IN  IS NULL  IS NOT NULL  ( )  AND
 * Literals: bounded numeric, single-quoted string ('' escape), DATE, TIME, TIMESTAMP
 *
 * Rejected / unsupported:
 *   OR, general NOT, functions, arithmetic, casts, subqueries, UDFs,
 *   host variables, comments, statement separators, trailing tokens
 */

const { LIMITS } = require('./constants');
const { utf8ByteLength } = require('./util');

const PARSE_REASONS = Object.freeze({
  OK: 'OK',
  EMPTY: 'EMPTY_EXPRESSION',
  OVERSIZE: 'EXPRESSION_OVERSIZE',
  TOKEN_LIMIT: 'TOKEN_LIMIT_EXCEEDED',
  NESTING_LIMIT: 'NESTING_LIMIT_EXCEEDED',
  IN_LIST_LIMIT: 'IN_LIST_LIMIT_EXCEEDED',
  UNEXPECTED_TOKEN: 'UNEXPECTED_TOKEN',
  UNSUPPORTED_OR: 'UNSUPPORTED_OR',
  UNSUPPORTED_NOT: 'UNSUPPORTED_NOT',
  UNSUPPORTED_FUNCTION: 'UNSUPPORTED_FUNCTION',
  UNSUPPORTED_ARITHMETIC: 'UNSUPPORTED_ARITHMETIC',
  UNSUPPORTED_CAST: 'UNSUPPORTED_CAST',
  UNSUPPORTED_SUBQUERY: 'UNSUPPORTED_SUBQUERY',
  UNSUPPORTED_HOST_VAR: 'UNSUPPORTED_HOST_VAR',
  UNSUPPORTED_COMMENT: 'UNSUPPORTED_COMMENT',
  UNSUPPORTED_SEPARATOR: 'UNSUPPORTED_SEPARATOR',
  TRAILING_TOKENS: 'TRAILING_TOKENS',
  UNTERMINATED_STRING: 'UNTERMINATED_STRING',
  INVALID_LITERAL: 'INVALID_LITERAL',
  INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
});

function makeError(reason, message) {
  return {
    ok: false,
    supported: false,
    reason,
    message: String(message || reason),
    ast: null,
  };
}

function tokenize(expression) {
  const src = String(expression || '');
  if (!src.trim()) return makeError(PARSE_REASONS.EMPTY, 'Expression is empty.');
  if (utf8ByteLength(src) > LIMITS.maxExpressionUtf8Bytes) {
    return makeError(PARSE_REASONS.OVERSIZE, 'Expression exceeds UTF-8 byte bound.');
  }

  const tokens = [];
  let i = 0;
  const n = src.length;

  function push(type, value, start) {
    tokens.push({ type, value, start });
    if (tokens.length > LIMITS.maxParserTokens) {
      return false;
    }
    return true;
  }

  while (i < n) {
    const ch = src[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    // Comments — unsupported
    if (ch === '-' && src[i + 1] === '-') {
      return makeError(PARSE_REASONS.UNSUPPORTED_COMMENT, 'Comments are not supported.');
    }
    if (ch === '/' && src[i + 1] === '*') {
      return makeError(PARSE_REASONS.UNSUPPORTED_COMMENT, 'Comments are not supported.');
    }

    // Statement separators
    if (ch === ';' || ch === '\\') {
      return makeError(
        PARSE_REASONS.UNSUPPORTED_SEPARATOR,
        'Statement separators are not supported.'
      );
    }

    // Host variables
    if (ch === '?' || ch === ':' || ch === '@') {
      return makeError(PARSE_REASONS.UNSUPPORTED_HOST_VAR, 'Host variables are not supported.');
    }

    // String literal
    if (ch === "'") {
      const start = i;
      i += 1;
      let value = '';
      let closed = false;
      while (i < n) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          closed = true;
          i += 1;
          break;
        }
        value += src[i];
        i += 1;
      }
      if (!closed) {
        return makeError(PARSE_REASONS.UNTERMINATED_STRING, 'Unterminated string literal.');
      }
      if (value.length > LIMITS.maxManualLiteralChars) {
        return makeError(PARSE_REASONS.INVALID_LITERAL, 'String literal exceeds bound.');
      }
      if (!push('STRING', value, start)) {
        return makeError(PARSE_REASONS.TOKEN_LIMIT, 'Parser token limit exceeded.');
      }
      continue;
    }

    // Operators and punctuation
    if (ch === '(') {
      if (!push('LPAREN', '(', i))
        return makeError(PARSE_REASONS.TOKEN_LIMIT, 'Parser token limit exceeded.');
      i += 1;
      continue;
    }
    if (ch === ')') {
      if (!push('RPAREN', ')', i))
        return makeError(PARSE_REASONS.TOKEN_LIMIT, 'Parser token limit exceeded.');
      i += 1;
      continue;
    }
    if (ch === ',') {
      if (!push('COMMA', ',', i))
        return makeError(PARSE_REASONS.TOKEN_LIMIT, 'Parser token limit exceeded.');
      i += 1;
      continue;
    }
    if (ch === '<' && src[i + 1] === '>') {
      if (!push('OP', '<>', i))
        return makeError(PARSE_REASONS.TOKEN_LIMIT, 'Parser token limit exceeded.');
      i += 2;
      continue;
    }
    if (ch === '<' && src[i + 1] === '=') {
      if (!push('OP', '<=', i))
        return makeError(PARSE_REASONS.TOKEN_LIMIT, 'Parser token limit exceeded.');
      i += 2;
      continue;
    }
    if (ch === '>' && src[i + 1] === '=') {
      if (!push('OP', '>=', i))
        return makeError(PARSE_REASONS.TOKEN_LIMIT, 'Parser token limit exceeded.');
      i += 2;
      continue;
    }
    if (ch === '!' && src[i + 1] === '=') {
      // treat != as unsupported synonym — require <> only for clarity
      return makeError(PARSE_REASONS.UNEXPECTED_TOKEN, 'Operator != is not supported; use <>.');
    }
    if (ch === '<' || ch === '>' || ch === '=') {
      if (!push('OP', ch, i))
        return makeError(PARSE_REASONS.TOKEN_LIMIT, 'Parser token limit exceeded.');
      i += 1;
      continue;
    }

    // Arithmetic — unsupported
    if (ch === '+' || ch === '*' || ch === '/' || ch === '%') {
      return makeError(PARSE_REASONS.UNSUPPORTED_ARITHMETIC, 'Arithmetic is not supported.');
    }
    // Unary minus may start a number; bare minus between tokens handled below
    if (ch === '-' && (i === 0 || /[\s(,=<>]/.test(src[i - 1] || ''))) {
      // could be negative number — fall through to number lexing with sign
    } else if (ch === '-') {
      return makeError(PARSE_REASONS.UNSUPPORTED_ARITHMETIC, 'Arithmetic is not supported.');
    }

    // Numbers (optional leading -)
    if (
      (ch >= '0' && ch <= '9') ||
      (ch === '-' && i + 1 < n && src[i + 1] >= '0' && src[i + 1] <= '9')
    ) {
      const start = i;
      let j = i;
      if (src[j] === '-') j += 1;
      let sawDot = false;
      while (j < n) {
        const c = src[j];
        if (c >= '0' && c <= '9') {
          j += 1;
          continue;
        }
        if (c === '.' && !sawDot) {
          sawDot = true;
          j += 1;
          continue;
        }
        break;
      }
      const numText = src.slice(start, j);
      if (!/^-?\d+(\.\d+)?$/.test(numText)) {
        return makeError(PARSE_REASONS.INVALID_LITERAL, 'Invalid numeric literal.');
      }
      if (numText.length > 64) {
        return makeError(PARSE_REASONS.INVALID_LITERAL, 'Numeric literal exceeds bound.');
      }
      if (!push('NUMBER', numText, start)) {
        return makeError(PARSE_REASONS.TOKEN_LIMIT, 'Parser token limit exceeded.');
      }
      i = j;
      continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$#]/.test(src[j])) j += 1;
      // Reject function call form IDENT( — but allow keyword IN (
      const word = src.slice(start, j);
      let k = j;
      while (k < n && (src[k] === ' ' || src[k] === '\t')) k += 1;
      if (k < n && src[k] === '(') {
        const upper = word.toUpperCase();
        // IN (list) is a predicate keyword, not a function call
        if (upper === 'IN') {
          if (!push('IDENT', word, start)) {
            return makeError(PARSE_REASONS.TOKEN_LIMIT, 'Parser token limit exceeded.');
          }
          i = j;
          continue;
        }
        // Only DATE/TIME/TIMESTAMP literal constructors allowed as keywords, not as functions
        // DATE '...' is keyword + string; DATE(...) is a function → unsupported
        if (upper === 'DATE' || upper === 'TIME' || upper === 'TIMESTAMP') {
          return makeError(
            PARSE_REASONS.UNSUPPORTED_FUNCTION,
            'Temporal function form is not supported.'
          );
        }
        if (upper === 'CAST' || upper === 'CONVERT') {
          return makeError(PARSE_REASONS.UNSUPPORTED_CAST, 'Cast expressions are not supported.');
        }
        return makeError(PARSE_REASONS.UNSUPPORTED_FUNCTION, 'Function calls are not supported.');
      }
      // Subquery SELECT
      if (word.toUpperCase() === 'SELECT') {
        return makeError(PARSE_REASONS.UNSUPPORTED_SUBQUERY, 'Subqueries are not supported.');
      }
      if (!push('IDENT', word, start)) {
        return makeError(PARSE_REASONS.TOKEN_LIMIT, 'Parser token limit exceeded.');
      }
      i = j;
      continue;
    }

    return makeError(PARSE_REASONS.UNEXPECTED_TOKEN, 'Unexpected character in expression.');
  }

  return { ok: true, tokens };
}

function parseExpression(expression) {
  const lexed = tokenize(expression);
  if (!lexed.ok) return lexed;

  const tokens = lexed.tokens;
  let pos = 0;
  let nesting = 0;

  function peek() {
    return pos < tokens.length ? tokens[pos] : null;
  }

  function consume() {
    const t = peek();
    if (t) pos += 1;
    return t;
  }

  function expect(type, value) {
    const t = peek();
    if (!t || t.type !== type || (value != null && t.value.toUpperCase() !== value)) {
      return null;
    }
    return consume();
  }

  function parsePrimary() {
    const t = peek();
    if (!t) return makeError(PARSE_REASONS.UNEXPECTED_TOKEN, 'Unexpected end of expression.');

    if (t.type === 'LPAREN') {
      nesting += 1;
      if (nesting > LIMITS.maxParserNesting) {
        return makeError(PARSE_REASONS.NESTING_LIMIT, 'Parser nesting limit exceeded.');
      }
      consume();
      const inner = parseOrReject();
      if (!inner.ok) return inner;
      if (!expect('RPAREN')) {
        return makeError(PARSE_REASONS.UNEXPECTED_TOKEN, 'Expected closing parenthesis.');
      }
      nesting -= 1;
      return { ok: true, ast: { type: 'group', expr: inner.ast } };
    }

    // Temporal literals: DATE '...' / TIME '...' / TIMESTAMP '...'
    if (t.type === 'IDENT') {
      const upper = t.value.toUpperCase();
      if (upper === 'DATE' || upper === 'TIME' || upper === 'TIMESTAMP') {
        consume();
        const lit = peek();
        if (!lit || lit.type !== 'STRING') {
          return makeError(PARSE_REASONS.INVALID_LITERAL, 'Temporal literal requires a string.');
        }
        consume();
        return {
          ok: true,
          ast: { type: 'literal', kind: upper.toLowerCase(), value: lit.value },
        };
      }
      if (upper === 'NULL') {
        consume();
        return { ok: true, ast: { type: 'literal', kind: 'null', value: null } };
      }
      if (upper === 'OR') {
        return makeError(PARSE_REASONS.UNSUPPORTED_OR, 'OR is not supported.');
      }
      if (upper === 'NOT') {
        // Only "IS NOT NULL" is allowed, handled in predicate path
        return makeError(PARSE_REASONS.UNSUPPORTED_NOT, 'General NOT is not supported.');
      }
      // Identifier reference
      if (!/^[A-Za-z_][A-Za-z0-9_$#]*$/.test(t.value)) {
        return makeError(PARSE_REASONS.INVALID_IDENTIFIER, 'Invalid identifier.');
      }
      consume();
      return { ok: true, ast: { type: 'identifier', name: t.value } };
    }

    if (t.type === 'NUMBER') {
      consume();
      return { ok: true, ast: { type: 'literal', kind: 'number', value: t.value } };
    }
    if (t.type === 'STRING') {
      consume();
      return { ok: true, ast: { type: 'literal', kind: 'string', value: t.value } };
    }

    return makeError(PARSE_REASONS.UNEXPECTED_TOKEN, 'Unexpected token in primary expression.');
  }

  function parsePredicate() {
    // Handle IS NULL / IS NOT NULL after a primary
    const left = parsePrimary();
    if (!left.ok) return left;

    const t = peek();
    if (!t) return left;

    // IS [NOT] NULL
    if (t.type === 'IDENT' && t.value.toUpperCase() === 'IS') {
      consume();
      let not = false;
      const n1 = peek();
      if (n1 && n1.type === 'IDENT' && n1.value.toUpperCase() === 'NOT') {
        not = true;
        consume();
      }
      const n2 = peek();
      if (!n2 || n2.type !== 'IDENT' || n2.value.toUpperCase() !== 'NULL') {
        return makeError(PARSE_REASONS.UNEXPECTED_TOKEN, 'Expected NULL after IS.');
      }
      consume();
      return {
        ok: true,
        ast: {
          type: 'is_null',
          not,
          expr: left.ast,
        },
      };
    }

    // BETWEEN
    if (t.type === 'IDENT' && t.value.toUpperCase() === 'BETWEEN') {
      consume();
      const low = parsePrimary();
      if (!low.ok) return low;
      const andTok = peek();
      if (!andTok || andTok.type !== 'IDENT' || andTok.value.toUpperCase() !== 'AND') {
        return makeError(PARSE_REASONS.UNEXPECTED_TOKEN, 'Expected AND in BETWEEN.');
      }
      consume();
      const high = parsePrimary();
      if (!high.ok) return high;
      return {
        ok: true,
        ast: {
          type: 'between',
          expr: left.ast,
          low: low.ast,
          high: high.ast,
        },
      };
    }

    // IN ( list )
    if (t.type === 'IDENT' && t.value.toUpperCase() === 'IN') {
      consume();
      if (!expect('LPAREN')) {
        return makeError(PARSE_REASONS.UNEXPECTED_TOKEN, 'Expected ( after IN.');
      }
      // Subquery after IN?
      const maybeSelect = peek();
      if (
        maybeSelect &&
        maybeSelect.type === 'IDENT' &&
        maybeSelect.value.toUpperCase() === 'SELECT'
      ) {
        return makeError(PARSE_REASONS.UNSUPPORTED_SUBQUERY, 'Subqueries are not supported.');
      }
      const list = [];
      for (;;) {
        const item = parsePrimary();
        if (!item.ok) return item;
        list.push(item.ast);
        if (list.length > LIMITS.maxInListSize) {
          return makeError(PARSE_REASONS.IN_LIST_LIMIT, 'IN list size limit exceeded.');
        }
        const sep = peek();
        if (sep && sep.type === 'COMMA') {
          consume();
          continue;
        }
        break;
      }
      if (!expect('RPAREN')) {
        return makeError(PARSE_REASONS.UNEXPECTED_TOKEN, 'Expected ) after IN list.');
      }
      return {
        ok: true,
        ast: {
          type: 'in',
          expr: left.ast,
          list,
        },
      };
    }

    // Comparison operators
    if (t.type === 'OP') {
      const op = t.value;
      consume();
      const right = parsePrimary();
      if (!right.ok) return right;
      return {
        ok: true,
        ast: {
          type: 'compare',
          op,
          left: left.ast,
          right: right.ast,
        },
      };
    }

    return left;
  }

  function parseAnd() {
    const first = parsePredicate();
    if (!first.ok) return first;
    let node = first.ast;
    for (;;) {
      const t = peek();
      if (!t || t.type !== 'IDENT' || t.value.toUpperCase() !== 'AND') break;
      // Disambiguate BETWEEN's AND — parsePredicate already consumed those.
      // Here AND joins predicates.
      consume();
      // Reject OR-like mistakes
      const next = parsePredicate();
      if (!next.ok) return next;
      node = { type: 'and', left: node, right: next.ast };
    }
    return { ok: true, ast: node };
  }

  function parseOrReject() {
    // Explicitly reject OR at this level
    const anded = parseAnd();
    if (!anded.ok) return anded;
    const t = peek();
    if (t && t.type === 'IDENT' && t.value.toUpperCase() === 'OR') {
      return makeError(PARSE_REASONS.UNSUPPORTED_OR, 'OR is not supported.');
    }
    return anded;
  }

  const result = parseOrReject();
  if (!result.ok) return result;
  if (pos < tokens.length) {
    return makeError(PARSE_REASONS.TRAILING_TOKENS, 'Trailing unparsed tokens.');
  }

  return {
    ok: true,
    supported: true,
    reason: PARSE_REASONS.OK,
    message: 'ok',
    ast: result.ast,
  };
}

/**
 * Collect identifier names referenced by a supported AST (stable sorted unique).
 */
function collectIdentifiers(ast, out = new Set()) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.type === 'identifier') {
    out.add(ast.name);
    return out;
  }
  for (const key of Object.keys(ast)) {
    const child = ast[key];
    if (Array.isArray(child)) {
      for (const item of child) collectIdentifiers(item, out);
    } else if (child && typeof child === 'object') {
      collectIdentifiers(child, out);
    }
  }
  return out;
}

/**
 * Derive simple boundary vectors from a supported AST.
 * Returns assignments that should accept / reject when possible.
 * Conservative: only generates vectors for clear compare/between/in/is_null forms.
 */
function deriveVectorsFromAst(ast, tableHint) {
  const vectors = [];
  if (!ast) return vectors;

  function pushCompare(ident, op, literal) {
    if (!ident || literal == null) return;
    const col = ident.name;
    const litVal = literalValue(literal);
    if (litVal === undefined) return;
    if (op === '=') {
      vectors.push({
        assignments: { [col]: litVal },
        expected: 'accept',
        rationale: `Column ${col} equals constrained literal.`,
      });
      vectors.push({
        assignments: { [col]: alterLiteral(litVal) },
        expected: 'reject',
        rationale: `Column ${col} differs from constrained equality literal.`,
      });
    } else if (op === '<>') {
      vectors.push({
        assignments: { [col]: alterLiteral(litVal) },
        expected: 'accept',
        rationale: `Column ${col} differs from disallowed equality literal.`,
      });
      vectors.push({
        assignments: { [col]: litVal },
        expected: 'reject',
        rationale: `Column ${col} equals disallowed literal.`,
      });
    } else if (op === '<' || op === '<=' || op === '>' || op === '>=') {
      vectors.push({
        assignments: { [col]: litVal },
        expected: op.includes('=') ? 'accept' : 'reject',
        rationale: `Boundary value for ${col} ${op} constraint.`,
      });
    }
  }

  function literalValue(node) {
    if (!node || node.type !== 'literal') return undefined;
    if (node.kind === 'null') return null;
    if (node.kind === 'number') return { kind: 'number', value: node.value };
    if (node.kind === 'string') return { kind: 'string', value: node.value };
    if (node.kind === 'date' || node.kind === 'time' || node.kind === 'timestamp') {
      return { kind: node.kind, value: node.value };
    }
    return undefined;
  }

  function alterLiteral(litVal) {
    if (litVal == null) return { kind: 'string', value: 'X' };
    if (typeof litVal === 'object' && litVal.kind === 'number') {
      // Deterministic alternate without float math
      if (litVal.value === '0' || litVal.value === '0.0') {
        return { kind: 'number', value: '1' };
      }
      return { kind: 'number', value: '0' };
    }
    if (typeof litVal === 'object' && litVal.kind === 'string') {
      return { kind: 'string', value: litVal.value === 'A' ? 'B' : 'A' };
    }
    if (typeof litVal === 'object' && litVal.kind === 'date') {
      return { kind: 'date', value: litVal.value === '0001-01-01' ? '9999-12-31' : '0001-01-01' };
    }
    return { kind: 'string', value: 'Z' };
  }

  function walk(node) {
    if (!node) return;
    if (node.type === 'group') {
      walk(node.expr);
      return;
    }
    if (node.type === 'and') {
      walk(node.left);
      walk(node.right);
      return;
    }
    if (node.type === 'compare') {
      if (
        node.left &&
        node.left.type === 'identifier' &&
        node.right &&
        node.right.type === 'literal'
      ) {
        pushCompare(node.left, node.op, node.right);
      } else if (
        node.right &&
        node.right.type === 'identifier' &&
        node.left &&
        node.left.type === 'literal'
      ) {
        // Flip ops for literal-on-left
        const flip = { '=': '=', '<>': '<>', '<': '>', '<=': '>=', '>': '<', '>=': '<=' };
        pushCompare(node.right, flip[node.op] || node.op, node.left);
      }
      return;
    }
    if (node.type === 'between') {
      if (node.expr && node.expr.type === 'identifier') {
        const col = node.expr.name;
        const low = literalValue(node.low);
        const high = literalValue(node.high);
        if (low !== undefined) {
          vectors.push({
            assignments: { [col]: low },
            expected: 'accept',
            rationale: `Column ${col} at BETWEEN lower bound.`,
          });
        }
        if (high !== undefined) {
          vectors.push({
            assignments: { [col]: high },
            expected: 'accept',
            rationale: `Column ${col} at BETWEEN upper bound.`,
          });
        }
      }
      return;
    }
    if (node.type === 'in') {
      if (node.expr && node.expr.type === 'identifier' && Array.isArray(node.list)) {
        const col = node.expr.name;
        const allowedKeys = new Set();
        for (const item of node.list) {
          const v = literalValue(item);
          if (v !== undefined) {
            vectors.push({
              assignments: { [col]: v },
              expected: 'accept',
              rationale: `Column ${col} member of IN list.`,
            });
            // Stable membership key for collision-free negative selection.
            if (v == null) allowedKeys.add('null');
            else if (typeof v === 'object' && v.kind) {
              allowedKeys.add(`${v.kind}:${v.value}`);
            } else {
              allowedKeys.add(String(v));
            }
          }
        }
        // Deterministic negative candidate outside the complete allowed list.
        let negative = { kind: 'string', value: '__NOT_IN_LIST__' };
        let negKey = 'string:__NOT_IN_LIST__';
        if (allowedKeys.has(negKey)) {
          for (let i = 0; i < 10000; i += 1) {
            const candidate = `__OUT_${i}__`;
            negKey = `string:${candidate}`;
            if (!allowedKeys.has(negKey)) {
              negative = { kind: 'string', value: candidate };
              break;
            }
          }
        }
        vectors.push({
          assignments: { [col]: negative },
          expected: 'reject',
          rationale: `Column ${col} outside IN list.`,
        });
      }
      return;
    }
    if (node.type === 'is_null') {
      if (node.expr && node.expr.type === 'identifier') {
        const col = node.expr.name;
        if (node.not) {
          vectors.push({
            assignments: { [col]: null },
            expected: 'reject',
            rationale: `Column ${col} IS NOT NULL rejects null.`,
          });
          vectors.push({
            assignments: { [col]: { kind: 'string', value: 'X' } },
            expected: 'accept',
            rationale: `Column ${col} IS NOT NULL accepts non-null.`,
          });
        } else {
          vectors.push({
            assignments: { [col]: null },
            expected: 'accept',
            rationale: `Column ${col} IS NULL accepts null.`,
          });
          vectors.push({
            assignments: { [col]: { kind: 'string', value: 'X' } },
            expected: 'reject',
            rationale: `Column ${col} IS NULL rejects non-null.`,
          });
        }
      }
    }
  }

  walk(ast);
  // Attach table hint metadata for generator normalization
  return vectors.map(v => ({
    ...v,
    table: tableHint || null,
  }));
}

module.exports = {
  PARSE_REASONS,
  tokenize,
  parseExpression,
  collectIdentifiers,
  deriveVectorsFromAst,
};
