import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { findProductionE2EMutations } from '../scripts/production_e2e_readonly_guard.mjs';

const workflowPath = new URL('../../.github/workflows/production-frontend-e2e.yml', import.meta.url);

function workflowText() {
  return fs.readFileSync(workflowPath, 'utf8');
}

test('production frontend E2E is structurally read-only and uses the dedicated guard', () => {
  const yaml = workflowText();

  assert.match(
    yaml,
    /node scripts\/production_e2e_readonly_guard\.mjs \.\.\/\.github\/workflows\/production-frontend-e2e\.yml/,
  );
  assert.doesNotMatch(yaml, /grep\s+-E[q]?\s+['"][^'"\n]*(POST|purge)/i);
  assert.deepEqual(findProductionE2EMutations(yaml), []);
});

test('readonly guard detects known production fixture mutations without matching its own implementation text', () => {
  const unsafe = `
      - name: Create disposable production access code
        run: curl -fsS -X POST "$E2E_BASE_URL/api/v1/mkety-admin/access-codes"
      - name: Purge disposable production workspace
        run: curl -fsS -X POST "$E2E_BASE_URL/api/v1/mkety-admin/test-workspaces/example/purge"
  `;

  const findings = findProductionE2EMutations(unsafe);
  assert.ok(findings.some((finding) => finding.includes('fixture creation')));
  assert.ok(findings.some((finding) => finding.includes('production mutation')));
});
