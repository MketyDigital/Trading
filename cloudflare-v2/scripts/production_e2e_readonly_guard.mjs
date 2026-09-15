import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const MUTATION_RULES = [
  {
    label: 'fixture creation via production admin access-code POST',
    pattern: /(?:curl[^\n]*-X\s+POST[^\n]*\/api\/v1\/mkety-admin\/access-codes(?:\s|["'])|method\s*:\s*['"]POST['"][\s\S]{0,400}\/api\/v1\/mkety-admin\/access-codes)/i,
  },
  {
    label: 'production mutation via test-workspace purge',
    pattern: /\/api\/v1\/mkety-admin\/test-workspaces\/[^\s"']+\/purge/i,
  },
  {
    label: 'production mutation via access-code revoke',
    pattern: /\/api\/v1\/mkety-admin\/access-codes\/[^\s"']+\/revoke/i,
  },
  {
    label: 'fixture redemption against production',
    pattern: /(?:curl[^\n]*-X\s+POST[^\n]*\/api\/v1\/access\/redeem|method\s*:\s*['"]POST['"][\s\S]{0,400}\/api\/v1\/access\/redeem)/i,
  },
  {
    label: 'fixture creation marker',
    pattern: /Create disposable production access code/i,
  },
  {
    label: 'fixture purge marker',
    pattern: /Purge disposable production workspace/i,
  },
];

export function findProductionE2EMutations(workflowText = '') {
  const text = String(workflowText || '');
  const findings = [];
  for (const rule of MUTATION_RULES) {
    if (rule.pattern.test(text)) findings.push(rule.label);
  }
  return findings;
}

function main(argv = process.argv.slice(2)) {
  const [workflowPath] = argv;
  if (!workflowPath) {
    console.error('Usage: node scripts/production_e2e_readonly_guard.mjs <workflow-path>');
    return 2;
  }

  let workflow;
  try {
    workflow = fs.readFileSync(workflowPath, 'utf8');
  } catch (error) {
    console.error(`Unable to read production E2E workflow: ${error?.message || error}`);
    return 2;
  }

  const findings = findProductionE2EMutations(workflow);
  if (findings.length) {
    console.error('Production frontend E2E must remain read-only. Mutating patterns found:');
    for (const finding of findings) console.error(`- ${finding}`);
    return 1;
  }

  console.log('Production frontend E2E is structurally read-only.');
  return 0;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exitCode = main();
