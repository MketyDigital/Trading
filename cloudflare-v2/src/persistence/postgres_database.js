/** Thin Hyperdrive/node-postgres session. Create one instance per Worker request;
 * Hyperdrive owns the shared network pool. SQL/repositories stay domain-owned. */
export class PostgresTradingDatabase {
  constructor(client) {
    if (!client || typeof client.connect !== 'function' || typeof client.query !== 'function' || typeof client.end !== 'function') {
      throw new Error('PostgreSQL client must implement connect, query, and end');
    }
    this.client = client;
    this.connected = false;
    this.closed = false;
    this.operationTail = Promise.resolve();
  }

  async exclusive(work) {
    const previous = this.operationTail;
    let release;
    this.operationTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await work(); }
    finally { release(); }
  }

  async connect() {
    if (this.closed) throw new Error('PostgreSQL session is closed');
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
    return this;
  }

  async query(text, values = []) {
    return this.exclusive(async () => {
      await this.connect();
      return this.client.query(text, values);
    });
  }

  async transaction(work) {
    if (typeof work !== 'function') throw new Error('PostgreSQL transaction callback is required');
    return this.exclusive(async () => {
      await this.connect();
      await this.client.query('BEGIN');
      try {
        const result = await work((text, values = []) => this.client.query(text, values));
        await this.client.query('COMMIT');
        return result;
      } catch (error) {
        try { await this.client.query('ROLLBACK'); } catch { /* keep the original failure */ }
        throw error;
      }
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.connected) await this.client.end();
  }
}

export async function createPostgresTradingDatabase(hyperdrive, { ClientClass } = {}) {
  const connectionString = String(hyperdrive?.connectionString || '').trim();
  if (!connectionString) throw new Error('Dedicated TRADING_PG Hyperdrive connectionString is required');
  const Client = ClientClass || (await import('pg')).Client;
  const db = new PostgresTradingDatabase(new Client({ connectionString }));
  await db.connect();
  return db;
}
