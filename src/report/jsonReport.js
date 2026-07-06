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
const { createJsonOutput } = require('../cli/helpers/jsonOutput');

/**
 * Artifact writer. Uses the central JSON helper (which applies sanitization).
 * Kept as thin wrapper for backward compatibility with callers.
 */
function writeJsonReport(filePath, data) {
  const json = createJsonOutput({}, { forceJson: true, maskSecrets: true });
  json.writeFile(filePath, data);
}

module.exports = {
  writeJsonReport,
};
