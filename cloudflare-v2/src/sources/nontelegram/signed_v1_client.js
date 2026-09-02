import { signSourcePayload } from '../../security/source_auth.js';

function requiredString(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function validateEndpoint(value) {
  let url;
  try {
    url = new URL(requiredString(value, 'SOURCE_ENDPOINT_INVALID'));
  } catch {
    throw new Error('SOURCE_ENDPOINT_INVALID');
  }
  if (
    url.protocol !== 'https:'
    || url.pathname !== '/api/v1/events'
    || url.search
    || url.hash
    || !url.hostname
  ) {
    throw new Error('SOURCE_ENDPOINT_INVALID');
  }
  return url.toString();
}

function normalizeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

export class RetryableSourceDeliveryError extends Error {
  constructor(code, status = null) {
    super(String(code));
    this.name = 'RetryableSourceDeliveryError';
    this.code = String(code);
    this.status = normalizeStatus(status);
  }
}

export class PermanentSourceDeliveryError extends Error {
  constructor(code, status = null) {
    super(String(code));
    this.name = 'PermanentSourceDeliveryError';
    this.code = String(code);
    this.status = normalizeStatus(status);
  }
}

async function defaultTransport(request) {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  return {
    status: response.status,
    body: await response.text(),
  };
}

function parseSuccess(response) {
  const status = normalizeStatus(response?.status);
  if (status === null) throw new RetryableSourceDeliveryError('NETWORK_ERROR');
  if (status === 429 || status >= 500) {
    throw new RetryableSourceDeliveryError('HTTP_RETRYABLE', status);
  }
  if (status < 200 || status >= 300) {
    throw new PermanentSourceDeliveryError('HTTP_REJECTED', status);
  }

  let parsed;
  try {
    parsed = JSON.parse(String(response?.body ?? ''));
  } catch {
    throw new PermanentSourceDeliveryError('INVALID_RESPONSE', status);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.ok !== true) {
    throw new PermanentSourceDeliveryError('INVALID_RESPONSE', status);
  }
  return parsed;
}

export function createSignedV1SourceClient({
  endpoint,
  sourceId,
  sourceSecret,
  transport = defaultTransport,
  nowMs = () => Date.now(),
} = {}) {
  const url = validateEndpoint(endpoint);
  const id = requiredString(sourceId, 'SOURCE_ID_REQUIRED');
  const secret = requiredString(sourceSecret, 'SOURCE_SECRET_REQUIRED');
  if (typeof transport !== 'function') throw new Error('SOURCE_TRANSPORT_REQUIRED');
  if (typeof nowMs !== 'function') throw new Error('SOURCE_CLOCK_REQUIRED');

  return Object.freeze({
    async send(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new PermanentSourceDeliveryError('SOURCE_PAYLOAD_INVALID');
      }

      const rawBody = JSON.stringify(payload);
      const timestamp = String(Number(nowMs()));
      if (!Number.isFinite(Number(timestamp))) {
        throw new PermanentSourceDeliveryError('SOURCE_CLOCK_INVALID');
      }
      const signature = await signSourcePayload(rawBody, timestamp, secret);
      const request = {
        method: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
          'X-Mkety-Source-Id': id,
          'X-Mkety-Timestamp': timestamp,
          'X-Mkety-Signature': signature,
        },
        body: rawBody,
      };

      let response;
      try {
        response = await transport(request);
      } catch (error) {
        if (error instanceof RetryableSourceDeliveryError || error instanceof PermanentSourceDeliveryError) {
          throw error;
        }
        throw new RetryableSourceDeliveryError('NETWORK_ERROR');
      }
      return parseSuccess(response);
    },
  });
}
