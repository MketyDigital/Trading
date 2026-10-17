import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTradingStorageAuthority, verifyTradingStorageAuthority } from '../src/persistence/trading_storage_authority.js';

test('D1 is the explicit initial authority and must have its binding', () => {
  const DB = { prepare() {} };
  assert.deepEqual(resolveTradingStorageAuthority({ TRADING_STORAGE_AUTHORITY: 'd1', DB }), { kind: 'd1', binding: DB, authorityEpoch: 1 });
  assert.throws(() => resolveTradingStorageAuthority({ TRADING_STORAGE_AUTHORITY: 'd1' }), /D1 binding/);
});

test('Postgres authority requires the dedicated Hyperdrive binding', () => {
  assert.equal(resolveTradingStorageAuthority({ TRADING_STORAGE_AUTHORITY: 'postgres', TRADING_PG: { connectionString: 'postgres://db' } }).kind, 'postgres');
  assert.throws(() => resolveTradingStorageAuthority({ TRADING_STORAGE_AUTHORITY: 'postgres' }), /TRADING_PG/);
});

test('an unknown authority fails closed rather than falling back', () => {
  assert.throws(() => resolveTradingStorageAuthority({ TRADING_STORAGE_AUTHORITY: 'supabase', DB: {}, TRADING_PG: {} }), /Unsupported/);
});

test('unconfigured authority defaults only to the initial D1 authority', () => {
  assert.equal(resolveTradingStorageAuthority({ DB: { prepare() {} } }).kind, 'd1');
});

test('persisted authority rejects stale or fenced Worker deployments', async () => {
  const authority = { kind: 'd1', authorityEpoch: 6, binding: { prepare: () => ({ first: async () => ({ activeAuthority: 'postgres', authorityEpoch: 7, writesFenced: 1 }) }) } };
  await assert.rejects(() => verifyTradingStorageAuthority(authority), /fenced by a different active authority/);
});

test('persisted D1 authority accepts only the matching unfenced epoch', async () => {
  const authority = { kind: 'd1', authorityEpoch: 7, binding: { prepare: () => ({ first: async () => ({ activeAuthority: 'd1', authorityEpoch: 7, writesFenced: 0 }) }) } };
  assert.deepEqual(await verifyTradingStorageAuthority(authority), { authority: 'd1', authorityEpoch: 7, writable: true });
});

test('persisted PostgreSQL authority is verified through its connected session', async () => {
  const authority = { kind: 'postgres', authorityEpoch: 9, binding: { connectionString: 'postgres://db' } };
  const postgresDatabase = { query: async () => ({ rows: [{ activeAuthority: 'postgres', authorityEpoch: '9', writesFenced: false }] }) };
  assert.deepEqual(await verifyTradingStorageAuthority(authority, { postgresDatabase }), { authority: 'postgres', authorityEpoch: 9, writable: true });
});
