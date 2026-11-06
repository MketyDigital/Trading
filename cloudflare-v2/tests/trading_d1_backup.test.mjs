import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptSecret, encryptSecret } from '../src/security/secret_box.js';
import { decryptTradingD1BackupFile, encryptTradingD1BackupFile } from '../scripts/trading_d1_backup.mjs';

test('D1 backup streams large SQL exports through authenticated v2 encryption', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trading-d1-backup-test-'));
  const inputPath = join(directory, 'before.sql');
  const encryptedPath = join(directory, 'before.sql.enc');
  const decryptedPath = join(directory, 'recovered.sql');
  const masterKey = 'test-trading-master-key';
  const chunk = Buffer.from("INSERT INTO workspaces VALUES ('workspace-1', 'sensitive-value');\n");
  const sql = Buffer.concat(Array.from({ length: 350000 }, () => chunk));
  try {
    await writeFile(inputPath, sql, { mode: 0o600 });
    const encryptedResult = await encryptTradingD1BackupFile({ inputPath, outputPath: encryptedPath, masterKey });
    assert.equal(encryptedResult.bytesEncrypted, sql.length);
    const encrypted = await readFile(encryptedPath);
    assert.equal(encrypted.subarray(0, 27).toString('ascii'), 'MKETY-TRADING-D1-BACKUP-V2\n');
    assert.equal(encrypted.includes(Buffer.from('sensitive-value')), false);
    const recovered = await decryptTradingD1BackupFile({ inputPath: encryptedPath, outputPath: decryptedPath, masterKey });
    assert.equal(recovered.bytesRecovered, sql.length);
    assert.deepEqual(await readFile(decryptedPath), sql);
    assert.equal((await stat(encryptedPath)).mode & 0o777, 0o600);
    await assert.rejects(decryptTradingD1BackupFile({ inputPath: encryptedPath, outputPath: join(directory, 'wrong.sql'), masterKey: 'wrong-key' }));
    const damaged = Buffer.from(encrypted); damaged[damaged.length - 17] ^= 1;
    const damagedPath = join(directory, 'damaged.enc'); await writeFile(damagedPath, damaged);
    await assert.rejects(decryptTradingD1BackupFile({ inputPath: damagedPath, outputPath: join(directory, 'damaged.sql'), masterKey }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('legacy v1 D1 backup files remain decryptable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trading-d1-v1-test-'));
  const encryptedPath = join(directory, 'legacy.enc');
  const outputPath = join(directory, 'legacy.sql');
  const masterKey = 'legacy-test-key';
  const sql = 'CREATE TABLE legacy_backup (id TEXT);\n';
  try {
    await writeFile(encryptedPath, `${await encryptSecret(sql, masterKey)}\n`);
    const result = await decryptTradingD1BackupFile({ inputPath: encryptedPath, outputPath, masterKey });
    assert.equal(result.format, 'v1');
    assert.equal(await readFile(outputPath, 'utf8'), sql);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
