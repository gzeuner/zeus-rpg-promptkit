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
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfigLayers(baseValue, overrideValue) {
  if (overrideValue === undefined) {
    if (Array.isArray(baseValue)) return [...baseValue];
    if (isPlainObject(baseValue)) {
      return Object.fromEntries(Object.entries(baseValue).map(([key, value]) => [key, mergeConfigLayers(value, undefined)]));
    }
    return baseValue;
  }

  if (Array.isArray(overrideValue)) {
    return [...overrideValue];
  }

  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    const keys = new Set([...Object.keys(baseValue), ...Object.keys(overrideValue)]);
    const merged = {};
    for (const key of keys) {
      merged[key] = mergeConfigLayers(baseValue[key], overrideValue[key]);
    }
    return merged;
  }

  if (isPlainObject(overrideValue)) {
    return Object.fromEntries(Object.entries(overrideValue).map(([key, value]) => [key, mergeConfigLayers(undefined, value)]));
  }

  return overrideValue;
}

module.exports = {
  mergeConfigLayers,
};
