/**
 * QA Command
 * 
 * CLI command for running QA validation only.
 * Can be invoked standalone or as part of analyze workflow.
 */

async function run(args, config) {
  const { runQAPipeline, generateQAReport } = require('../src/qa/qaIntegration');
  const { readCanonicaAnalysisOutput } = require('../src/analyze/analyzeArtifactReader');

  console.log('Zeus RPG PromptKit - QA Validation');
  console.log('===================================\n');

  // Load canonical analysis if available
  let canonicalAnalysis = null;
  let sourceFiles = [];

  if (args.inputPath) {
    try {
      console.log(`Loading analysis from ${args.inputPath}...`);
      canonicalAnalysis = readCanonicalAnalysisOutput(args.inputPath);
      console.log('✓ Analysis loaded\n');
    } catch (error) {
      console.error(`Error loading analysis: ${error.message}`);
      if (!args.qaMode) {
        throw error;
      }
    }
  }

  // Build context
  const context = {
    canonicalAnalysis,
    sourceFiles,
    config,
  };

  // Run QA pipeline
  const qaConfig = {
    qaMode: true,
    qaStrict: args.strict || 'LENIENT',
  };

  const qaResults = await runQAPipeline(context, { qa: qaConfig });

  // Generate report
  const reportFormat = args.format || 'markdown';
  const report = generateQAReport(qaResults, { format: reportFormat });

  // Output report
  if (report.content) {
    console.log('\n' + report.content);
  } else if (report.status === 'SKIPPED') {
    console.log(report.message);
  }

  // Post to Jira if requested
  if (args.postComment && args.jiraTicket && report.canPostToJira) {
    console.log(`\n[INFO] To post to Jira ticket ${args.jiraTicket}:`);
    console.log('Copy the above content and paste as comment.');
  }

  // Exit code
  process.exitCode = qaResults.status === 'SUCCESS' ? 0 : 1;
}

module.exports = { run };
