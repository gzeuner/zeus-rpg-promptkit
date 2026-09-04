/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

'use strict';

const { resolveFetchConfig } = require('../../config/runtimeConfig');
const {
  SECRET_ENV_SENTINEL,
  executeClCommandRaw,
  ensureJavaHelperCompiled,
  runJavaHelper,
} = require('../../fetch/jt400CommandRunner');
const { ensureFetchConnectionGuard } = require('../../security/connectionGuards');
const {
  collectSensitiveTermsFromEnv,
  maskSecretsInText,
  maskSensitiveTermsInText,
} = require('../../security/secretMasking');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function requiredArgument(args, name) {
  const value = String(args[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required option: --${name} <value>`);
  }
  return value;
}

function optionalPositiveInteger(args, name, maximum) {
  if (args[name] === undefined || args[name] === null || args[name] === '') {
    return null;
  }
  const value = Number.parseInt(String(args[name]), 10);
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`--${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function maskSpoolText(value, sensitiveTerms) {
  const withoutUrlCredentials = String(value || '').replace(
    /(https?:\/\/)([^/\s:@]+):([^@\s/]+)@/gi,
    '$1[REDACTED]:[REDACTED]@'
  );
  return maskSensitiveTermsInText(maskSecretsInText(withoutUrlCredentials), sensitiveTerms);
}

function normalizeResult(result, sensitiveTerms) {
  return {
    found: result.found === true,
    matches: Array.isArray(result.matches)
      ? result.matches.map(match => ({
          jobNumber: String(match.jobNumber || ''),
          jobUser: String(match.jobUser || ''),
          jobName: String(match.jobName || ''),
          spoolFileName: String(match.spoolFileName || ''),
          spoolFileNumber: Number(match.spoolFileNumber || 0),
          truncated: match.truncated === true,
          text: maskSpoolText(match.text, sensitiveTerms),
        }))
      : [],
  };
}

function resolveRuntimeCwd(runtime) {
  return runtime && typeof runtime.cwd === 'string' && runtime.cwd.trim()
    ? runtime.cwd
    : process.cwd();
}

function resolveRuntimeEnv(runtime) {
  return runtime && runtime.env && typeof runtime.env === 'object' ? runtime.env : process.env;
}

async function run(args = {}, runtime = {}) {
  const runtimeOptions = runtime && typeof runtime === 'object' ? runtime : {};
  const cwd = resolveRuntimeCwd(runtimeOptions);
  const env = resolveRuntimeEnv(runtimeOptions);
  const profile = requiredArgument(args, 'profile');
  const jobNumber = requiredArgument(args, 'job-number');
  const jobUser = requiredArgument(args, 'job-user');
  const jobName = requiredArgument(args, 'job-name');
  const spoolFile = requiredArgument(args, 'spool-file');
  const spoolNumber = optionalPositiveInteger(args, 'spool-number', Number.MAX_SAFE_INTEGER);
  const maxBytes =
    optionalPositiveInteger(args, 'max-bytes', MAX_OUTPUT_BYTES) || DEFAULT_MAX_BYTES;
  const charset = String(args.charset || 'Cp037').trim();
  const fetchConfig = resolveFetchConfig(args, { cwd, env });
  const sensitiveTerms = collectSensitiveTermsFromEnv(env, [fetchConfig.password]);

  if (!fetchConfig.host || !fetchConfig.user || !fetchConfig.password) {
    throw new Error('Fetch connection configuration requires host, user, and password.');
  }

  if (!runtimeOptions.skipConnectionGuard) {
    ensureFetchConnectionGuard({
      fetchConfig: {
        host: fetchConfig.host,
        user: fetchConfig.user,
        password: fetchConfig.password,
      },
      scopeLabel: 'IBM i spool read connection',
      env,
      probe: probeOptions =>
        executeClCommandRaw({
          ...probeOptions,
          runtime: {
            ...runtimeOptions,
            skipConnectionGuard: true,
          },
        }),
    });
  }

  ensureJavaHelperCompiled({ ...runtimeOptions, cwd });
  const runJavaHelperFn = runtimeOptions.runJavaHelper || runJavaHelper;
  const javaArgs = [
    fetchConfig.host,
    fetchConfig.user,
    SECRET_ENV_SENTINEL,
    jobNumber,
    jobUser,
    jobName,
    spoolFile,
    spoolNumber === null ? '-' : String(spoolNumber),
    charset,
    String(maxBytes),
  ];

  const execution = runJavaHelperFn('IbmiSpooledFileReader', javaArgs, {
    password: fetchConfig.password,
    timeout: runtimeOptions.timeoutMs,
  });
  let result;
  try {
    result = JSON.parse(String(execution.stdout || '').trim());
  } catch (_) {
    const stdout = maskSpoolText(execution.stdout, sensitiveTerms).trim() || '(empty)';
    const stderr = maskSpoolText(execution.stderr, sensitiveTerms).trim() || '(empty)';
    throw new Error(
      `Spool reader returned invalid output (exit ${execution.status}): stdout=${stdout}; stderr=${stderr}`
    );
  }
  if (execution.status !== 0 || result.ok !== true) {
    throw new Error(
      maskSpoolText(result.error || execution.stderr || 'Spool reader failed.', sensitiveTerms)
    );
  }

  const output = normalizeResult(result, sensitiveTerms);
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return output;
  }
  if (!output.found) {
    console.log('No matching spool file found.');
    return output;
  }
  for (const match of output.matches) {
    console.log(
      `Spool file ${match.spoolFileName} (${match.spoolFileNumber}) for ${match.jobNumber}/${match.jobUser}/${match.jobName}`
    );
    if (match.truncated) {
      console.log(`Output truncated at ${maxBytes} bytes.`);
    }
    console.log(match.text);
  }
  return output;
}

module.exports = {
  maskSpoolText,
  optionalPositiveInteger,
  run,
};
