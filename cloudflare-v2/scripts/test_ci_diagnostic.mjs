import { appendFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync(new URL('../tests/', import.meta.url))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--test', `tests/${file}`], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const rawOutput = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(0, 6000);
    failures.push({ file, output: rawOutput || 'Test failed without output' });
    console.error(`::error file=tests/${file},title=Worker test failed::${(rawOutput || 'Test failed without output').replace(/\r?\n/g, '%0A')}`);
  }
}

if (failures.length) {
  const names = failures.map(({ file }) => file);
  console.error(`Failing Worker test files: ${names.join(', ')}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const sections = failures.map(({ file, output }) => `### \`${file}\`\n\n\`\`\`text\n${output}\n\`\`\``).join('\n\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Worker test failures\n\n${sections}\n`);
  }
  process.exit(1);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Worker tests\n\nAll ${files.length} Worker test files passed.\n`);
}
console.log(`All ${files.length} Worker test files passed.`);
