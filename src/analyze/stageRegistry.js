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
function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeAnchorList(value) {
  if (value === undefined || value === null) {
    return [];
  }

  const items = Array.isArray(value) ? value : [value];
  return Array.from(new Set(items
    .map((entry) => normalizeOptionalString(entry))
    .filter(Boolean)));
}

function normalizeStageDefinition(definition, options = {}) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('Invalid analyze stage definition: expected an object');
  }

  const id = normalizeOptionalString(definition.id);
  if (!id) {
    throw new Error('Invalid analyze stage definition: missing id');
  }
  if (typeof definition.run !== 'function') {
    throw new Error(`Invalid analyze stage definition for ${id}: missing run function`);
  }

  return {
    id,
    title: normalizeOptionalString(definition.title),
    description: normalizeOptionalString(definition.description),
    category: normalizeOptionalString(definition.category),
    pluginName: normalizeOptionalString(options.pluginName || definition.pluginName) || 'core',
    before: normalizeAnchorList(definition.before),
    after: normalizeAnchorList(definition.after),
    run: definition.run,
    beforeRun: typeof definition.beforeRun === 'function' ? definition.beforeRun : null,
    afterRun: typeof definition.afterRun === 'function' ? definition.afterRun : null,
    onError: typeof definition.onError === 'function' ? definition.onError : null,
    registrationOrder: Number(options.registrationOrder),
  };
}

function normalizeLifecycleHooks(hooks, options = {}) {
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw new Error('Invalid analyze lifecycle hooks: expected an object');
  }

  const beforeStage = typeof hooks.beforeStage === 'function' ? hooks.beforeStage : null;
  const afterStage = typeof hooks.afterStage === 'function' ? hooks.afterStage : null;
  const onStageError = typeof hooks.onStageError === 'function' ? hooks.onStageError : null;

  if (!beforeStage && !afterStage && !onStageError) {
    throw new Error('Invalid analyze lifecycle hooks: expected at least one hook function');
  }

  return {
    pluginName: normalizeOptionalString(options.pluginName || hooks.pluginName) || 'core',
    beforeStage,
    afterStage,
    onStageError,
  };
}

function sortByRegistrationOrder(entries) {
  return [...entries].sort((left, right) => left.registrationOrder - right.registrationOrder);
}

function buildResolvedOrder(stageDefinitions) {
  const stages = sortByRegistrationOrder(stageDefinitions);
  const byId = new Map();
  for (const stage of stages) {
    if (byId.has(stage.id)) {
      throw new Error(`Duplicate analyze stage id: ${stage.id}`);
    }
    byId.set(stage.id, stage);
  }

  const incoming = new Map(stages.map((stage) => [stage.id, new Set()]));
  const outgoing = new Map(stages.map((stage) => [stage.id, new Set()]));

  const addEdge = (fromId, toId, relation) => {
    if (!byId.has(fromId)) {
      throw new Error(`Analyze stage ${toId} references unknown ${relation} anchor: ${fromId}`);
    }
    if (!byId.has(toId)) {
      throw new Error(`Analyze stage ${fromId} references unknown ${relation} anchor: ${toId}`);
    }
    if (fromId === toId) {
      throw new Error(`Analyze stage ${fromId} cannot reference itself via ${relation}`);
    }

    incoming.get(toId).add(fromId);
    outgoing.get(fromId).add(toId);
  };

  for (const stage of stages) {
    for (const targetId of stage.before) {
      addEdge(stage.id, targetId, 'before');
    }
    for (const targetId of stage.after) {
      addEdge(targetId, stage.id, 'after');
    }
  }

  const ready = stages
    .filter((stage) => incoming.get(stage.id).size === 0)
    .sort((left, right) => left.registrationOrder - right.registrationOrder);
  const resolved = [];

  while (ready.length > 0) {
    const current = ready.shift();
    resolved.push(current);

    const nextIds = Array.from(outgoing.get(current.id))
      .sort((leftId, rightId) => byId.get(leftId).registrationOrder - byId.get(rightId).registrationOrder);

    for (const nextId of nextIds) {
      const dependencies = incoming.get(nextId);
      dependencies.delete(current.id);
      if (dependencies.size === 0) {
        ready.push(byId.get(nextId));
        ready.sort((left, right) => left.registrationOrder - right.registrationOrder);
      }
    }
  }

  if (resolved.length !== stages.length) {
    const unresolved = stages
      .filter((stage) => !resolved.some((entry) => entry.id === stage.id))
      .map((stage) => stage.id);
    throw new Error(`Analyze stage ordering contains a cycle: ${unresolved.join(', ')}`);
  }

  return resolved;
}

function createAnalyzeStageRegistry() {
  const stageDefinitions = [];
  const lifecycleHooks = [];

  const api = {
    registerStage(definition, options = {}) {
      const registrationOrder = stageDefinitions.length;
      const stage = normalizeStageDefinition(definition, {
        ...options,
        registrationOrder,
      });
      stageDefinitions.push(stage);
      return api;
    },

    registerLifecycleHooks(hooks, options = {}) {
      lifecycleHooks.push(normalizeLifecycleHooks(hooks, options));
      return api;
    },

    use(plugin) {
      const pluginName = normalizeOptionalString(plugin && plugin.name) || 'anonymous-plugin';
      const register = typeof plugin === 'function'
        ? plugin
        : (plugin && typeof plugin.register === 'function' ? plugin.register.bind(plugin) : null);

      if (!register) {
        throw new Error(`Invalid analyze plugin ${pluginName}: missing register function`);
      }

      register({
        registerStage(definition) {
          return api.registerStage(definition, { pluginName });
        },
        registerLifecycleHooks(hooks) {
          return api.registerLifecycleHooks(hooks, { pluginName });
        },
        listStages() {
          return api.listStages();
        },
        listLifecycleHooks() {
          return api.listLifecycleHooks();
        },
      });
      return api;
    },

    listStages() {
      return sortByRegistrationOrder(stageDefinitions).map((stage) => ({
        id: stage.id,
        title: stage.title,
        description: stage.description,
        category: stage.category,
        pluginName: stage.pluginName,
        before: [...stage.before],
        after: [...stage.after],
        registrationOrder: stage.registrationOrder,
      }));
    },

    listLifecycleHooks() {
      return lifecycleHooks.map((entry, index) => ({
        pluginName: entry.pluginName,
        registrationOrder: index,
        hooks: {
          beforeStage: Boolean(entry.beforeStage),
          afterStage: Boolean(entry.afterStage),
          onStageError: Boolean(entry.onStageError),
        },
      }));
    },

    resolveStages() {
      return buildResolvedOrder(stageDefinitions).map((stage) => ({
        ...stage,
        before: [...stage.before],
        after: [...stage.after],
      }));
    },

    resolveLifecycleHooks() {
      return lifecycleHooks.map((entry) => ({
        ...entry,
      }));
    },
  };

  return api;
}

module.exports = {
  createAnalyzeStageRegistry,
};
