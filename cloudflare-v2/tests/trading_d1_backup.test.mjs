import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptTradingD1BackupFile, encryptTradingD1BackupFile } from '../scripts/trading_d1_backup.mjs';

test('D1 recovery export is encrypted at rest and can be recovered only with its master key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trading-d1-backup-test-'));
  const inputPath = join(directory, 'before.sql');
  const encryptedPath = join(directory, 'before.sql.enc');
  const decryptedPath = join(directory, 'recovered.sql');
  const masterKey = 'test-trading-master-key';
  const sql = "INSERT INTO workspaces (id, tg_bot_token_ciphertext) VALUES ('workspace-1', 'sensitive-value');\n";
  try {
    await writeFile(inputPath, sql, { mode: 0o600 });
    await encryptTradingD1BackupFile({ inputPath, outputPath: encryptedPath, masterKey });
    const encrypted = await readFile(encryptedPath, 'utf8');
    assert.notEqual(encrypted, sql);
    assert.equal(encrypted.includes('sensitive-value'), false);

    await decryptTradingD1BackupFile({ inputPath: encryptedPath, outputPath: decryptedPath, masterKey });
    assert.equal(await readFile(decryptedPath, 'utf8'), sql);
    await assert.rejects(
      decryptTradingD1BackupFile({ inputPath: encryptedPath, outputPath: join(directory, 'wrong-key.sql'), masterKey: 'wrong-key' }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
