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
const path = require('path');
const { executeImpact } = require('../../core/impactService');

function runImpact(args) {
  const verbose = Boolean(args.verbose);
  let execution;
  try {
    execution = executeImpact(args);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const { result, graphPath, program, outputProgramDir, target } = execution;

  if (verbose) {
    console.log(`[verbose] Target: ${target}`);
    console.log(`[verbose] Graph path: ${graphPath}`);
    console.log(`[verbose] Output program: ${program}`);
  }

  console.log(`Impact analysis complete for target ${result.target}`);
  console.log(`Type: ${result.type}`);
  console.log(`Total affected programs: ${result.totalAffectedPrograms || 0}`);
  console.log(`Output written to: ${outputProgramDir}`);
}

module.exports = {
  runImpact,
};
