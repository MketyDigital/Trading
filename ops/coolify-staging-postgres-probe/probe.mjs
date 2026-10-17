import { createServer } from 'node:http';
import { checkStagingPostgresConnection } from './scripts/check_staging_postgres_connection.mjs';

const identity = await checkStagingPostgresConnection();
console.log(`TRADING_PG_PROBE_OK=${JSON.stringify(identity)}`);

createServer((request, response) => {
  if (request.url !== '/health') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('ok');
}).listen(3000, '0.0.0.0');
