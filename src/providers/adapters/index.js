/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
*/
'use strict';

const { createPrivateHttpJsonTransport } = require('./privateHttpTransport');
const { createOllamaModelAdapter } = require('./ollama');
const { createOpenAICompatibleModelAdapter } = require('./openaiCompatible');

module.exports = Object.freeze({
  createPrivateHttpJsonTransport,
  createOllamaModelAdapter,
  createOpenAICompatibleModelAdapter,
});
