import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const templatePath = path.join(rootDir, 'templates', 'ai-session-prompt.template.md');
const outputDir = path.join(rootDir, 'output-baseline', 'PROGRAM_100');
const outputPath = path.join(outputDir, 'ai-session-prompt.md');

if (!fs.existsSync(templatePath)) {
  throw new Error(`Missing template: ${templatePath}`);
}

fs.mkdirSync(outputDir, { recursive: true });
const template = fs.readFileSync(templatePath, 'utf8');
const content = `${template.trim()}\n\n## Artifact Paths\n\n- report: \`report.md\`\n- architecture: \`architecture-report.md\`\n- canonical: \`canonical-analysis.json\`\n- ai knowledge: \`ai-knowledge.json\`\n- dependency graph: \`dependency-graph.mmd\`\n`;

fs.writeFileSync(outputPath, content, 'utf8');
console.log(`Wrote ${outputPath}`);

