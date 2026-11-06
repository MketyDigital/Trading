import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, link, mkdtemp, open, readFile, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { decryptSecret, deriveSecretBoxKeyBytes } from '../src/security/secret_box.js';

const MAGIC = Buffer.from('MKETY-TRADING-D1-BACKUP-V2\n', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;

async function validateFileArguments({ inputPath, outputPath, masterKey } = {}) {
  if (typeof inputPath !== 'string' || !inputPath.trim() || typeof outputPath !== 'string' || !outputPath.trim()) {
    throw new Error('Trading D1 backup input and output paths are required');
  }
  if (inputPath === outputPath) throw new Error('Trading D1 backup input and output paths must differ');
  if (typeof masterKey !== 'string' || !masterKey.trim()) throw new Error('TRADING_MASTER_KEY is required for D1 backup protection');
}

async function withProtectedTemp(outputPath, writer) {
  const directory = dirname(outputPath);
  const tempDirectory = await mkdtemp(join(directory, '.trading-d1-backup-'));
  const tempPath = join(tempDirectory, 'payload');
  try {
    await writer(tempPath);
    await chmod(tempPath, 0o600);
    // link() publishes atomically and fails rather than overwriting an existing backup.
    await link(tempPath, outputPath);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Encrypt a Wrangler D1 SQL export using streaming AES-256-GCM (v2 envelope). */
export async function encryptTradingD1BackupFile({ inputPath, outputPath, masterKey } = {}) {
  await validateFileArguments({ inputPath, outputPath, masterKey });
  const input = await stat(inputPath);
  if (!input.isFile() || input.size === 0) throw new Error('Trading D1 backup export is empty');
  const key = await deriveSecretBoxKeyBytes(masterKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  let bytesEncrypted = 0;

  await withProtectedTemp(outputPath, async (tempPath) => {
    async function* encryptedChunks() {
      yield MAGIC;
      yield iv;
      for await (const chunk of createReadStream(inputPath)) {
        bytesEncrypted += chunk.length;
        const encrypted = cipher.update(chunk);
        if (encrypted.length) yield encrypted;
      }
      const final = cipher.final();
      if (final.length) yield final;
      yield cipher.getAuthTag();
    }
    await pipeline(Readable.from(encryptedChunks()), createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
  });
  return { bytesEncrypted, outputPath };
}

/** Recover v2 streaming backups and legacy v1 secret-box exports. */
export async function decryptTradingD1BackupFile({ inputPath, outputPath, masterKey } = {}) {
  await validateFileArguments({ inputPath, outputPath, masterKey });
  const input = await stat(inputPath);
  if (!input.isFile() || input.size === 0) throw new Error('Trading D1 encrypted backup is empty');

  const prefix = await open(inputPath, 'r');
  let header;
  try {
    header = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await prefix.read(header, 0, MAGIC.length, 0);
    header = header.subarray(0, bytesRead);
  } finally {
    await prefix.close();
  }

  if (!header.equals(MAGIC)) {
    // Compatibility path for backups created by the previous v1 string envelope.
    const ciphertext = (await readFile(inputPath, 'utf8')).trim();
    if (!ciphertext) throw new Error('Trading D1 encrypted backup is empty');
    const plaintext = await decryptSecret(ciphertext, masterKey);
    if (!plaintext.trim()) throw new Error('Trading D1 decrypted backup is empty');
    const bytes = Buffer.byteLength(plaintext);
    await withProtectedTemp(outputPath, async (tempPath) => {
      const handle = await open(tempPath, 'wx', 0o600);
      try { await handle.writeFile(plaintext, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
    });
    return { bytesRecovered: bytes, outputPath, format: 'v1' };
  }

  const minimumSize = MAGIC.length + IV_BYTES + TAG_BYTES + 1;
  if (input.size < minimumSize) throw new Error('Trading D1 encrypted backup is malformed');
  const ivHandle = await open(inputPath, 'r');
  let iv;
  let tag;
  try {
    iv = Buffer.alloc(IV_BYTES);
    const ivRead = await ivHandle.read(iv, 0, IV_BYTES, MAGIC.length);
    if (ivRead.bytesRead !== IV_BYTES) throw new Error('Trading D1 encrypted backup is malformed');
    tag = Buffer.alloc(TAG_BYTES);
    const tagRead = await ivHandle.read(tag, 0, TAG_BYTES, input.size - TAG_BYTES);
    if (tagRead.bytesRead !== TAG_BYTES) throw new Error('Trading D1 encrypted backup is malformed');
  } finally {
    await ivHandle.close();
  }

  const key = await deriveSecretBoxKeyBytes(masterKey);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  const ciphertextStart = MAGIC.length + IV_BYTES;
  const ciphertextEnd = input.size - TAG_BYTES - 1;
  let bytesRecovered = 0;

  await withProtectedTemp(outputPath, async (tempPath) => {
    const meter = async function* () {
      for await (const chunk of createReadStream(inputPath, { start: ciphertextStart, end: ciphertextEnd })) {
        bytesRecovered += chunk.length;
        yield chunk;
      }
    };
    await pipeline(Readable.from(meter()), decipher, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
  });

  if (bytesRecovered === 0) {
    await unlink(outputPath).catch(() => {});
    throw new Error('Trading D1 decrypted backup is empty');
  }
  return { bytesRecovered, outputPath, format: 'v2' };
}
