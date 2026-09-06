'use strict';

const CLI_INVOCATIONS = Object.freeze({
  portable: 'node cli/zeus.js',
  powershell: 'node .\\cli\\zeus.js',
  posix: 'node ./cli/zeus.js',
});

function configureCliOutput({ stdout = process.stdout, stderr = process.stderr } = {}) {
  for (const stream of [stdout, stderr]) {
    if (stream && typeof stream.setDefaultEncoding === 'function')
      stream.setDefaultEncoding('utf8');
  }
}

function cliInvocation({ platform = 'portable', args = [] } = {}) {
  const prefix = CLI_INVOCATIONS[platform] || CLI_INVOCATIONS.portable;
  const values = Array.isArray(args) ? args : [args];
  return [prefix, ...values.map(value => String(value || '').trim()).filter(Boolean)].join(' ');
}

module.exports = { CLI_INVOCATIONS, cliInvocation, configureCliOutput };
