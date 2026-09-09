import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function productionSourceFiles() {
  const roots = [
    '.github/workflows/production-cloudflare-deploy.yml',
    '.github/workflows/production-frontend-e2e.yml',
    'server.js',
  ];
  const srcRoot = path.join(repoRoot, 'cloudflare-v2/src');
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    if (!entry.isFile() || !/\.(?:js|mjs|json|toml)$/.test(entry.name)) return [];
    return [path.relative(repoRoot, absolute)];
  });
  return [...roots, ...walk(srcRoot)];
}

test('production code does not depend on anonymous public GitHub hosting', () => {
  const forbidden = [
    /raw\.githubusercontent\.com/i,
    /(?:^|\W)github\.io(?:\W|$)/i,
  ];

  for (const relativePath of productionSourceFiles()) {
    const source = read(relativePath);
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${relativePath} must remain private-repository compatible`);
    }
  }
});

test('package dependencies do not require anonymous GitHub repository access', () => {
  for (const relativePath of ['package.json', 'cloudflare-v2/package.json']) {
    const pkg = JSON.parse(read(relativePath));
    const specs = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.optionalDependencies || {}),
    };

    for (const [name, spec] of Object.entries(specs)) {
      assert.doesNotMatch(
        String(spec),
        /(?:^github:|git(?:\+https?|\+ssh)?:|github\.com|raw\.githubusercontent\.com)/i,
        `${relativePath} dependency ${name} must use a private-compatible package source`,
      );
    }
  }
});

test('production deployment uses authenticated GitHub Actions checkout', () => {
  for (const relativePath of [
    '.github/workflows/production-cloudflare-deploy.yml',
    '.github/workflows/production-frontend-e2e.yml',
  ]) {
    const workflow = read(relativePath);
    assert.match(workflow, /uses:\s*actions\/checkout@v\d+/i, `${relativePath} must use authenticated actions/checkout`);
  }
});
