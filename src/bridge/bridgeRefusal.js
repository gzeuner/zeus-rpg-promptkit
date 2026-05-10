/*
Copyright 2026 Zeus PromptKit Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
class BridgeRefusalError extends Error {
  constructor({ code, message, hints = [], exitCode = 3 }) {
    super(message);
    this.name = 'BridgeRefusalError';
    this.code = code || 'BRIDGE_REFUSED';
    this.hints = Array.isArray(hints) ? hints : [];
    this.exitCode = Number.isInteger(exitCode) ? exitCode : 3;
  }

  toJSON() {
    return {
      kind: 'bridge-refusal',
      code: this.code,
      message: this.message,
      hints: this.hints,
    };
  }
}

function throwBridgeRefusal(details) {
  throw new BridgeRefusalError(details);
}

module.exports = {
  BridgeRefusalError,
  throwBridgeRefusal,
};
