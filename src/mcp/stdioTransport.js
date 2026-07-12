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

const HEADER_SEPARATOR = Buffer.from('\r\n\r\n', 'utf8');

function findHeaderSeparator(buffer) {
  return buffer.indexOf(HEADER_SEPARATOR);
}

function encodeJsonRpcMessage(payload) {
  const body = Buffer.from(`${JSON.stringify(payload)}`, 'utf8');
  const headers = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  return Buffer.concat([headers, body]);
}

function tryReadHeaderFramedMessage(buffer) {
  const headerEnd = findHeaderSeparator(buffer);
  if (headerEnd === -1) {
    return null;
  }

  const headerText = buffer.slice(0, headerEnd).toString('utf8');
  const match = headerText.match(/content-length\s*:\s*(\d+)/i);
  if (!match) {
    return null;
  }
  const contentLength = Number.parseInt(match[1], 10);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new Error(`Invalid Content-Length header: ${match[1]}`);
  }

  const bodyStart = headerEnd + HEADER_SEPARATOR.length;
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) {
    return null;
  }

  return {
    raw: buffer.slice(bodyStart, bodyEnd).toString('utf8'),
    nextOffset: bodyEnd,
  };
}

function tryReadLineMessage(buffer) {
  const lineEnd = buffer.indexOf(0x0a); // \n
  if (lineEnd === -1) {
    return null;
  }
  const raw = buffer
    .slice(0, lineEnd + 1)
    .toString('utf8')
    .trim();
  return {
    raw,
    nextOffset: lineEnd + 1,
  };
}

function parseIncomingMessages(chunkBuffer, initialBuffer = Buffer.alloc(0)) {
  let pending =
    initialBuffer.length > 0 ? Buffer.concat([initialBuffer, chunkBuffer]) : chunkBuffer;
  const messages = [];

  while (pending.length > 0) {
    let parsed = null;

    const looksLikeHeader = pending
      .slice(0, 32)
      .toString('utf8')
      .toLowerCase()
      .includes('content-length');
    if (looksLikeHeader) {
      parsed = tryReadHeaderFramedMessage(pending);
      if (parsed === null) {
        break;
      }
    } else {
      parsed = tryReadLineMessage(pending);
      if (parsed === null) {
        break;
      }
    }

    if (parsed.raw) {
      messages.push(parsed.raw);
    }
    pending = pending.slice(parsed.nextOffset);
  }

  return {
    messages,
    pending,
  };
}

function createStdioTransport({ input = process.stdin, output = process.stdout, onMessage }) {
  let pending = Buffer.alloc(0);

  const handleData = chunk => {
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    const parsed = parseIncomingMessages(chunkBuffer, pending);
    pending = parsed.pending;

    for (const rawMessage of parsed.messages) {
      if (!rawMessage) {
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(rawMessage);
      } catch (error) {
        onMessage({
          parseError: true,
          error,
          raw: rawMessage,
        });
        continue;
      }
      onMessage({
        parseError: false,
        payload,
      });
    }
  };

  return {
    start() {
      input.on('data', handleData);
    },
    stop() {
      input.off('data', handleData);
    },
    send(payload) {
      output.write(encodeJsonRpcMessage(payload));
    },
  };
}

module.exports = {
  createStdioTransport,
  encodeJsonRpcMessage,
  parseIncomingMessages,
};
