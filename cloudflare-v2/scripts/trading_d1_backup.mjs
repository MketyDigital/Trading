import { chmod, open, readFile, unlink } from 'node:fs/promises';
import { decryptSecret, encryptSecret } from '../src/security/secret_box.js';

async function validateFileArguments({ inputPath, outputPath, masterKey } = {}) {
  if (typeof inputPath !== 'string' || !inputPath.trim() || typeof outputPath !== 'string' || !outputPath.trim()) {
    throw new Error('Trading D1 backup input and output paths are required');
  }
  if (inputPath === outputPath) throw new Error('Trading D1 backup input and output paths must differ');
  if (typeof masterKey !== 'string' || !masterKey.trim()) throw new Error('TRADING_MASTER_KEY is required for D1 backup protection');
}

async function writeProtectedFile(path, value) {
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(value, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(path, 0o600);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(path).catch(() => {});
    throw error;
  }
}

/** Encrypt a Wrangler D1 SQL export for short-lived workflow artifact retention. */
export async function encryptTradingD1BackupFile({ inputPath, outputPath, masterKey } = {}) {
  await validateFileArguments({ inputPath, outputPath, masterKey });
  const plaintext = await readFile(inputPath, 'utf8');
  if (!plaintext.trim()) throw new Error('Trading D1 backup export is empty');
  const ciphertext = await encryptSecret(plaintext, masterKey);
  await writeProtectedFile(outputPath, `${ciphertext}\n`);
  return { bytesEncrypted: Buffer.byteLength(plaintext), outputPath };
}

/** Recover a protected D1 SQL export without writing its contents to logs. */
export async function decryptTradingD1BackupFile({ inputPath, outputPath, masterKey } = {}) {
  await validateFileArguments({ inputPath, outputPath, masterKey });
  const ciphertext = (await readFile(inputPath, 'utf8')).trim();
  if (!ciphertext) throw new Error('Trading D1 encrypted backup is empty');
  const plaintext = await decryptSecret(ciphertext, masterKey);
  if (!plaintext.trim()) throw new Error('Trading D1 decrypted backup is empty');
  await writeProtectedFile(outputPath, plaintext);
  return { bytesRecovered: Buffer.byteLength(plaintext), outputPath };
}
