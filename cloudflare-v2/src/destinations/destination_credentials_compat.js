export function normalizeDestinationCredentialPlaintext(plaintext) {
  let envelope;
  try {
    envelope = JSON.parse(String(plaintext ?? ''));
  } catch {
    return plaintext;
  }
  if (envelope?.version !== 1 || envelope?.kind !== 'destination' || !envelope?.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
    return plaintext;
  }
  const data = { ...envelope.data };
  if (!data.signingSecret && !data.signing_secret && data.secret) {
    data.signingSecret = data.secret;
    delete data.secret;
  }
  return JSON.stringify({ ...envelope, data });
}
