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

const path = require('path');
const {
  createOrLoadSession,
  recordInvestigationEvent,
  listSessions,
} = require('../../investigation/investigationSession');
const { focus, search, generateFocusedPrompt } = require('../../investigation/investigationActions');
const { resolveAnalyzeConfig } = require('../../config/runtimeConfig');

function runInvestigate(args) {
  const program = args.program || args.member || '';
  if (!program) {
    console.error('Missing required option: --program <name> or --member <name>');
    process.exit(2);
  }

  const cwd = process.cwd();
  const config = resolveAnalyzeConfig(args, { cwd, env: process.env });
  const outputRoot = path.resolve(cwd, config.outputRoot || 'output');
  const outputProgramDir = path.join(outputRoot, String(program).trim());

  const goal = args.goal || args.description || '';
  const sessionId = args.session || null;

  if (args.list) {
    const sessions = listSessions(outputProgramDir);
    if (sessions.length === 0) {
      console.log('No investigation sessions found for this program.');
      return;
    }
    console.log(`Investigation sessions for ${program}:`);
    sessions.forEach((s) => {
      console.log(`  ${s.id}  (last active: ${s.lastActiveAt})  ${s.goal ? '- ' + s.goal : ''}`);
    });
    return;
  }

  // Handle actions
  if (args.focus) {
    const focusPatch = {};
    if (typeof args.focus === 'string') {
      focusPatch.searchScopes = [args.focus];
    } else if (args.focus && typeof args.focus === 'object') {
      Object.assign(focusPatch, args.focus);
    }
    const result = focus({ analysisDir: outputProgramDir, sessionId, goal, focus: focusPatch });
    console.log(result.message);
    return;
  }

  if (args.search) {
    const terms = Array.isArray(args.search) ? args.search : [args.search];
    const result = search({ analysisDir: outputProgramDir, sessionId, terms, goal });
    console.log(result.message || 'Search completed.');
    if (result.results) {
      console.log('Matches summary:', result.results.summary || result.results);
    }
    return;
  }

  if (args['generate-prompt'] || args.generatePrompt) {
    const result = generateFocusedPrompt({ analysisDir: outputProgramDir, sessionId, goal });
    console.log('Focused Prompt:\n');
    console.log(result.prompt);
    return;
  }

  // Default: create/load session
  const { session } = createOrLoadSession({
    outputProgramDir,
    sessionId,
    goal,
  });

  console.log(`Investigation session: ${session.id}`);
  console.log(`Base analysis: ${outputProgramDir}`);
  if (session.goal) console.log(`Goal: ${session.goal}`);
  const f = session.focus || {};
  console.log(`Focus: programs=${(f.programs || []).length}, tables=${(f.tables || []).length}`);

  const sessionDir = path.join(outputProgramDir, '.investigations', session.id);
  recordInvestigationEvent({ session, sessionPath: path.join(sessionDir, 'session.json') }, {
    type: 'session-start',
    goal: session.goal,
  });

  console.log('\nSession ready.');
  console.log('Use --focus "<scope>", --search "<term>", or --generate-prompt');
}

module.exports = {
  runInvestigate,
};
