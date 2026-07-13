'use strict';

function renderMarkdownReport(report) {
  const lines = [];

  lines.push(`# Repository Control Report`);
  lines.push(``);
  lines.push(`**Repository**: ${report.repository.nameWithOwner}`);
  lines.push(`**Scope**: ${report.scope}`);
  lines.push(`**Decision**: ${report.decision}`);
  lines.push(`**Technical Decision**: ${report.technicalDecision}`);
  lines.push(`**Observed SHA**: ${report.observedSha || 'N/A'}`);
  if (report.localCandidateSha) {
    lines.push(`**Local Candidate**: ${report.localCandidateSha}`);
  }
  lines.push(`**Observed At**: ${report.observedAt}`);
  lines.push(``);

  if (report.blockers.length) {
    lines.push(`## Blockers`);
    for (const b of report.blockers) {
      lines.push(`- **${b.code}**: ${b.message}`);
    }
    lines.push(``);
  }

  if (report.warnings.length) {
    lines.push(`## Warnings`);
    for (const w of report.warnings) {
      lines.push(`- **${w.code}**: ${w.message}`);
    }
    lines.push(``);
  }

  if (report.unknowns.length) {
    lines.push(`## Unknowns`);
    for (const u of report.unknowns) {
      lines.push(`- **${u.code}**: ${u.message}`);
    }
    lines.push(``);
  }

  if (report.checks && report.checks.length) {
    lines.push(`## Checks (sample)`);
    for (const c of report.checks.slice(0, 10)) {
      lines.push(
        `- ${c.name || c.context || 'check'}: ${c.status || c.state || c.conclusion || 'unknown'}`
      );
    }
    lines.push(``);
  }

  lines.push(`> This is a read-only report. No changes were made to the repository.`);
  return lines.join('\n');
}

module.exports = {
  renderJsonReport: report => JSON.stringify(report, null, 2),
  renderMarkdownReport,
};
