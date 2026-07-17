/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
*/
'use strict';

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_REDIRECTS = 2;
const DEFAULT_TIMEOUT_MS = 5000;
const METADATA_HOST_PATTERNS = [
  /^metadata$/i,
  /^metadata\./i,
  /^metadata\.google\.internal$/i,
  /^169\.254\.169\.254$/,
];

function fixedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw fixedError('TRANSPORT_CONFIG_INVALID', 'adapter endpoint is invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw fixedError('TRANSPORT_CONFIG_INVALID', 'adapter endpoint protocol is unsupported');
  }
  if (url.username || url.password) {
    throw fixedError('TRANSPORT_CONFIG_INVALID', 'adapter endpoint credentials are not allowed');
  }
  if (!url.hostname) {
    throw fixedError('TRANSPORT_CONFIG_INVALID', 'adapter endpoint host is required');
  }
  return url;
}

function normalizeHeaders(headers) {
  if (!headers) return Object.freeze({});
  if (typeof headers !== 'object' || Array.isArray(headers)) {
    throw fixedError('TRANSPORT_CONFIG_INVALID', 'adapter headers are invalid');
  }
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== 'string' || !key || /[\r\n]/.test(key) || /[\r\n]/.test(value)) {
      throw fixedError('TRANSPORT_CONFIG_INVALID', 'adapter headers are invalid');
    }
    normalized[key] = value;
  }
  return Object.freeze(normalized);
}

function normalizeDestinationPolicy(policy = {}) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw fixedError('TRANSPORT_CONFIG_INVALID', 'destination policy is invalid');
  }
  return Object.freeze({
    allowLoopback: policy.allowLoopback === true,
    allowPrivate: policy.allowPrivate === true,
    allowPublic: policy.allowPublic === true,
  });
}

function isMetadataHostname(hostname) {
  return METADATA_HOST_PATTERNS.some(pattern => pattern.test(hostname));
}

function classifyIpv4(address) {
  const parts = address.split('.').map(part => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)
  )
    return 'invalid';
  const [a, b] = parts;
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 0 || a >= 224) return 'disallowed';
  return 'public';
}

function classifyIpv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === '::1') return 'loopback';
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return 'link-local';
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return 'private';
  if (normalized === '::' || normalized.startsWith('ff')) return 'disallowed';
  return 'public';
}

function classifyAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return classifyIpv4(address);
  if (family === 6) return classifyIpv6(address);
  return 'invalid';
}

function assertAddressAllowed(address, policy) {
  const classification = classifyAddress(address);
  if (classification === 'loopback') {
    if (!policy.allowLoopback) {
      throw fixedError(
        'TRANSPORT_DESTINATION_DENIED',
        'loopback destinations require explicit opt-in'
      );
    }
    return classification;
  }
  if (classification === 'private') {
    if (!policy.allowPrivate) {
      throw fixedError(
        'TRANSPORT_DESTINATION_DENIED',
        'private-network destinations require explicit opt-in'
      );
    }
    return classification;
  }
  if (classification === 'public') {
    if (!policy.allowPublic) {
      throw fixedError(
        'TRANSPORT_DESTINATION_DENIED',
        'public internet destinations are denied by default'
      );
    }
    return classification;
  }
  if (classification === 'link-local') {
    throw fixedError(
      'TRANSPORT_DESTINATION_DENIED',
      'link-local and metadata destinations are denied'
    );
  }
  throw fixedError('TRANSPORT_DESTINATION_DENIED', 'destination address is denied');
}

async function resolveDestination(url, policy) {
  if (isMetadataHostname(url.hostname)) {
    throw fixedError('TRANSPORT_DESTINATION_DENIED', 'metadata destinations are denied');
  }
  if (net.isIP(url.hostname)) {
    return {
      hostname: url.hostname,
      family: net.isIP(url.hostname),
      trustClass: assertAddressAllowed(url.hostname, policy),
    };
  }
  let addresses;
  try {
    addresses = await dns.promises.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw fixedError('TRANSPORT_DNS_FAILED', 'destination name resolution failed');
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw fixedError('TRANSPORT_DNS_FAILED', 'destination name resolution failed');
  }
  let chosen = null;
  for (const address of addresses) {
    const trustClass = assertAddressAllowed(address.address, policy);
    if (!chosen) {
      chosen = { hostname: address.address, family: address.family, trustClass };
    }
  }
  return chosen;
}

function buildRequestOptions(url, method, headers, resolvedAddress, signal) {
  const isTls = url.protocol === 'https:';
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (isTls ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method,
    headers,
    signal,
    lookup(hostname, options, callback) {
      callback(null, resolvedAddress.hostname, resolvedAddress.family);
    },
    ...(isTls ? { servername: url.hostname } : {}),
  };
}

function parseRedirect(baseUrl, location) {
  let redirected;
  try {
    redirected = new URL(location, baseUrl);
  } catch {
    throw fixedError('TRANSPORT_REDIRECT_INVALID', 'redirect target is invalid');
  }
  if (redirected.username || redirected.password) {
    throw fixedError('TRANSPORT_REDIRECT_INVALID', 'redirect target credentials are not allowed');
  }
  return redirected;
}

async function requestJson(options, state, redirectCount = 0) {
  const {
    endpoint,
    defaultHeaders,
    maxResponseBytes,
    maxRedirects,
    timeoutMs,
    destinationPolicy,
    body,
    method,
    path,
    signal,
  } = options;
  const requestUrl = new URL(path, endpoint);
  if (requestUrl.origin !== endpoint.origin) {
    throw fixedError('TRANSPORT_CONFIG_INVALID', 'request path escaped the configured endpoint');
  }
  const resolvedAddress = await resolveDestination(requestUrl, destinationPolicy);
  const bodyBuffer = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
  const headers = {
    accept: 'application/json',
    ...defaultHeaders,
    ...(bodyBuffer
      ? { 'content-type': 'application/json', 'content-length': String(bodyBuffer.length) }
      : {}),
  };
  const requestOptions = buildRequestOptions(requestUrl, method, headers, resolvedAddress, signal);
  const transport = requestUrl.protocol === 'https:' ? https : http;

  const response = await new Promise((resolve, reject) => {
    const req = transport.request(requestOptions, resolve);
    req.setTimeout(timeoutMs, () => {
      req.destroy(fixedError('TRANSPORT_TIMEOUT', 'transport request timed out'));
    });
    req.on('error', error => {
      if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
        reject(fixedError('TRANSPORT_ABORTED', 'transport request was cancelled'));
        return;
      }
      if (error && error.code === 'TRANSPORT_TIMEOUT') {
        reject(error);
        return;
      }
      reject(fixedError('TRANSPORT_REQUEST_FAILED', 'transport request failed'));
    });
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });

  if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
    response.resume();
    if (redirectCount >= maxRedirects) {
      throw fixedError('TRANSPORT_REDIRECT_LIMIT', 'redirect limit exceeded');
    }
    const location = response.headers.location;
    if (typeof location !== 'string' || !location.trim()) {
      throw fixedError('TRANSPORT_REDIRECT_INVALID', 'redirect target is invalid');
    }
    const redirected = parseRedirect(requestUrl, location);
    return requestJson(
      {
        ...options,
        endpoint: new URL(`${redirected.origin}${endpoint.pathname}`),
        path: `${redirected.pathname}${redirected.search}`,
        method: response.statusCode === 303 ? 'GET' : method,
        body: response.statusCode === 303 ? undefined : body,
      },
      state,
      redirectCount + 1
    );
  }

  const chunks = [];
  let bytes = 0;
  await new Promise((resolve, reject) => {
    response.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxResponseBytes) {
        response.destroy(fixedError('TRANSPORT_RESPONSE_LIMIT', 'response size limit exceeded'));
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', resolve);
    response.on('error', error => {
      if (error && error.code === 'TRANSPORT_RESPONSE_LIMIT') {
        reject(error);
        return;
      }
      reject(fixedError('TRANSPORT_REQUEST_FAILED', 'transport request failed'));
    });
  });

  const raw = Buffer.concat(chunks).toString('utf8');
  let parsed = null;
  if (raw.length) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw fixedError('TRANSPORT_RESPONSE_INVALID', 'response body is not valid JSON');
    }
  }
  if ((response.statusCode || 500) >= 400) {
    const error = fixedError('TRANSPORT_HTTP_ERROR', 'transport returned an error status');
    error.statusCode = response.statusCode;
    throw error;
  }
  return {
    statusCode: response.statusCode || 200,
    headers: response.headers,
    body: parsed,
    trustClass: resolvedAddress.trustClass,
  };
}

function createPrivateHttpJsonTransport({
  endpoint,
  headers,
  destinationPolicy,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  maxRedirects = MAX_REDIRECTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const baseEndpoint = parseEndpoint(endpoint);
  const defaultHeaders = normalizeHeaders(headers);
  const normalizedPolicy = normalizeDestinationPolicy(destinationPolicy);
  if (
    !Number.isInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > 1024 * 1024
  ) {
    throw fixedError('TRANSPORT_CONFIG_INVALID', 'response size limit is invalid');
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5) {
    throw fixedError('TRANSPORT_CONFIG_INVALID', 'redirect limit is invalid');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw fixedError('TRANSPORT_CONFIG_INVALID', 'timeout is invalid');
  }
  return Object.freeze({
    endpoint: baseEndpoint.origin,
    async requestJson({ method = 'GET', path = '/', body, signal } = {}) {
      return requestJson(
        {
          endpoint: baseEndpoint,
          defaultHeaders,
          maxResponseBytes,
          maxRedirects,
          timeoutMs,
          destinationPolicy: normalizedPolicy,
          body,
          method,
          path,
          signal,
        },
        {}
      );
    },
  });
}

module.exports = { createPrivateHttpJsonTransport };
