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
'use strict';

const { once } = require('node:events');
const { spawn } = require('node:child_process');

function sanitizedEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (/(?:credential|password|secret|token|private[_-]?key)/i.test(name)) {
      delete environment[name];
    }
  }
  return environment;
}

function createMcpStdioClient({ cliPath, cwd, allowTools = ['zeus.health'] }) {
  if (!cliPath || !cwd) {
    throw new TypeError('cliPath and cwd are required');
  }

  const child = spawn(
    process.execPath,
    [cliPath, 'mcp', 'serve', '--stdio', 'true', '--allow-tools', allowTools.join(',')],
    {
      cwd,
      env: sanitizedEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  let stdoutBuffer = Buffer.alloc(0);
  let stderr = '';
  const pending = new Map();
  let nextId = 1;
  let closed = false;

  const failPending = error => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk, 'utf8')]);
    while (stdoutBuffer.length > 0) {
      const separator = stdoutBuffer.indexOf(Buffer.from('\r\n\r\n', 'utf8'));
      if (separator < 0) return;
      const header = stdoutBuffer.slice(0, separator).toString('utf8');
      const lengthMatch = header.match(/content-length\s*:\s*(\d+)/i);
      if (!lengthMatch) {
        failPending(new Error('MCP emitted a frame without Content-Length'));
        return;
      }
      const contentLength = Number.parseInt(lengthMatch[1], 10);
      const bodyStart = separator + 4;
      const bodyEnd = bodyStart + contentLength;
      if (stdoutBuffer.length < bodyEnd) return;
      const body = stdoutBuffer.slice(bodyStart, bodyEnd).toString('utf8');
      stdoutBuffer = stdoutBuffer.slice(bodyEnd);
      let message;
      try {
        message = JSON.parse(body);
      } catch (error) {
        failPending(new Error(`MCP emitted invalid JSON: ${error.message}`));
        return;
      }
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  child.on('error', error => failPending(error));
  child.on('close', code => {
    closed = true;
    failPending(new Error(`MCP process exited with code ${code}: ${stderr.trim()}`));
  });

  return {
    async request(method, params = {}, timeoutMs = 5000) {
      if (closed || child.stdin.destroyed) {
        throw new Error('MCP process is not running');
      }
      const id = nextId++;
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8');
      const request = Buffer.concat([
        Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'),
        body,
      ]);
      const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for MCP response: ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
      });
      child.stdin.write(request);
      return response;
    },

    getStderr() {
      return stderr;
    },

    async close() {
      if (closed) return;
      child.stdin.end();
      await Promise.race([once(child, 'close'), new Promise(resolve => setTimeout(resolve, 1000))]);
      if (!closed) {
        child.kill();
        await Promise.race([
          once(child, 'close'),
          new Promise(resolve => setTimeout(resolve, 1000)),
        ]);
      }
    },
  };
}

module.exports = { createMcpStdioClient };
