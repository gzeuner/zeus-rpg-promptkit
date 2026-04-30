/*
Copyright 2026 Guido Zeuner

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const GLOBAL_PROFILE_KEYS = new Set(['contextOptimizer', 'testData', 'analysisLimits', 'presets']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function listSelectableProfiles(profiles) {
  return Object.entries(profiles || {})
    .filter(([name, value]) => !GLOBAL_PROFILE_KEYS.has(name) && isPlainObject(value))
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}

function resolveActiveProfile(preferredProfile, profileNames) {
  const preferred = String(preferredProfile || '').trim();
  if (preferred && Array.isArray(profileNames) && profileNames.includes(preferred)) {
    return preferred;
  }
  return Array.isArray(profileNames) && profileNames.length > 0 ? profileNames[0] : '';
}

module.exports = {
  GLOBAL_PROFILE_KEYS,
  listSelectableProfiles,
  resolveActiveProfile,
};

