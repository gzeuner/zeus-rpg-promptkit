'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
let WebSocketClient;
try {
  WebSocketClient = require('ws');
} catch {
  WebSocketClient = null;
}
const { commandExists, waitFor } = require('./e2eHarness');

function findChrome() {
  const candidates = [
    process.env.ZEUS_E2E_BROWSER_PATH,
    process.platform === 'win32'
      ? path.join(
          process.env.PROGRAMFILES || 'C:\\Program Files',
          'Google/Chrome/Application/chrome.exe'
        )
      : null,
    process.platform === 'win32'
      ? path.join(
          process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
          'Google/Chrome/Application/chrome.exe'
        )
      : null,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
  }
  for (const command of ['google-chrome', 'chromium', 'chromium-browser']) {
    if (commandExists(command)) return command;
  }
  return null;
}

function connectWebSocket(url, timeoutMs = 10000) {
  if (!WebSocketClient) {
    const error = new Error('The ws dev dependency is required for the GUI E2E module.');
    error.code = 'E2E_PREREQUISITE_MISSING';
    throw error;
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocketClient(url);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        // best effort
      }
      reject(new Error(`Timed out connecting to Chrome DevTools: ${url}`));
    }, timeoutMs);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', event => {
      clearTimeout(timer);
      reject(new Error(`Chrome DevTools WebSocket error: ${event.message || 'unknown error'}`));
    });
  });
}

async function stopChrome(child, userDataDir) {
  if (!child.killed && child.exitCode === null) child.kill();
  if (child.exitCode === null) {
    await Promise.race([once(child, 'close'), new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}

async function startChrome() {
  const browserPath = findChrome();
  if (!browserPath) {
    const error = new Error('Chrome/Chromium is not available for the GUI E2E module.');
    error.code = 'E2E_PREREQUISITE_MISSING';
    throw error;
  }
  if (!WebSocketClient) {
    const error = new Error('The ws dev dependency is required for the GUI E2E module.');
    error.code = 'E2E_PREREQUISITE_MISSING';
    throw error;
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-chrome-e2e-'));
  const child = spawn(
    browserPath,
    [
      '--headless=new',
      '--use-angle=swiftshader',
      '--disable-gpu-sandbox',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-features=VizDisplayCompositor',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });

  try {
    const activePortPath = path.join(userDataDir, 'DevToolsActivePort');
    const activePort = await waitFor(
      () => {
        if (!fs.existsSync(activePortPath)) return null;
        const [port] = fs.readFileSync(activePortPath, 'utf8').trim().split(/\r?\n/);
        return Number.parseInt(port, 10) || null;
      },
      { timeoutMs: 15000, message: `Chrome did not expose DevTools. ${stderr}` }
    );
    const page = await waitFor(
      async () => {
        const response = await fetch(`http://127.0.0.1:${activePort}/json/list`);
        const targets = await response.json();
        return targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
      },
      { timeoutMs: 15000, message: 'Chrome DevTools did not expose a page target.' }
    );
    const socket = await connectWebSocket(page.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 1;
    const handleMessage = event => {
      let message;
      try {
        const raw =
          typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.id && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
      }
    };
    socket.on('message', data => handleMessage({ data }));

    const send = (method, params = {}, timeoutMs = 15000) => {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Chrome DevTools request timed out: ${method}`));
        }, timeoutMs);
        pending.set(id, {
          resolve: value => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: error => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    };

    await send('Runtime.enable');
    await send('Page.enable');
    return {
      async navigate(url) {
        await send('Page.navigate', { url }, 30000);
        try {
          await send('Browser.grantPermissions', {
            origin: new URL(url).origin,
            permissions: ['clipboardReadWrite'],
          });
        } catch {
          // Clipboard permission is optional; the product fallback remains covered below.
        }
        await waitFor(async () => (await this.evaluate('document.readyState')) === 'complete', {
          timeoutMs: 15000,
          message: `Page did not finish loading: ${url}`,
        });
      },
      async evaluate(expression) {
        const result = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        });
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
        }
        return result.result ? result.result.value : undefined;
      },
      async close() {
        try {
          socket.close();
        } finally {
          await stopChrome(child, userDataDir);
        }
      },
    };
  } catch (error) {
    await stopChrome(child, userDataDir);
    throw error;
  }
}

module.exports = { findChrome, startChrome };
