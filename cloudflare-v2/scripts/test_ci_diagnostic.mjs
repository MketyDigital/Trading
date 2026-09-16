import { readdirSync } from 'node:fs';
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
    failures.push(file);
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(0, 6000).replace(/\r?\n/g, '%0A');
    console.error(`::error file=tests/${file},title=Worker test failed::${output || 'Test failed without output'}`);
  }
}

if (failures.length) {
  console.error(`Failing Worker test files: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`All ${files.length} Worker test files passed.`);
