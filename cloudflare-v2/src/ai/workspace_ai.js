import { UniversalAIRouter } from './universal_ai.js';
import { decryptSecret } from '../security/secret_box.js';

export async function createWorkspaceAIRouter(supabase, workspaceId, {
  masterKey,
  decryptFn = decryptSecret,
  fetchFn,
  env = {},
  circuitBreaker,
} = {}) {
  const trustedWorkspaceId = String(workspaceId ?? '').trim() || null;
  const routerOptions = { env, fetchFn, workspaceId: trustedWorkspaceId, circuitBreaker };
  if (!supabase?.from || !trustedWorkspaceId) return new UniversalAIRouter([], routerOptions);

  const { data, error } = await supabase
    .from('ai_providers')
    .select('*')
    .eq('workspace_id', trustedWorkspaceId)
    .eq('is_active', true);

  if (error || !Array.isArray(data)) {
    return new UniversalAIRouter([], routerOptions);
  }

  const credentialResolver = async (provider) => {
    const ciphertext = provider?.api_key_ciphertext;
    if (ciphertext) {
      if (!masterKey) throw new Error('TRADING_MASTER_KEY is required for encrypted AI credentials');
      return decryptFn(ciphertext, masterKey);
    }

    // Compatibility during migration only. New writes should use
    // api_key_ciphertext so provider secrets are never stored in plaintext.
    const legacyEncrypted = provider?.api_key_encrypted;
    if (typeof legacyEncrypted === 'string' && legacyEncrypted.startsWith('v1.')) {
      if (!masterKey) throw new Error('TRADING_MASTER_KEY is required for encrypted AI credentials');
      return decryptFn(legacyEncrypted, masterKey);
    }
    return provider?.resolved_api_key || legacyEncrypted || provider?.api_key || null;
  };

  return new UniversalAIRouter(data, {
    ...routerOptions,
    credentialResolver,
  });
}