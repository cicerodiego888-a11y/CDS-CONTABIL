'use strict';

const {
  encryptApiKey, decryptApiKey, last4Of
} = require('./crypto');

const PROVIDER = 'openai';

function createAiCredentialService({ db, id, auditSystem, config, testConnection }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  function fail(message, code, http = 400) {
    const error = new Error(message);
    error.code = code;
    error.http = http;
    return error;
  }

  function audit(tenantId, userId, action, payload) {
    if (auditSystem) {
      auditSystem(tenantId, userId || null, action, 'AI_CREDENTIAL', PROVIDER, payload);
    }
  }

  function masterKey() {
    return String((config && config.AI_CREDENTIAL_ENCRYPTION_KEY) || '').trim();
  }

  function requireMasterKey(hasStored) {
    const key = masterKey();
    if (key) return key;
    if (hasStored && config && config.IS_PROD) {
      throw fail(
        'AI_CREDENTIAL_ENCRYPTION_KEY é obrigatória em produção quando há credencial no cofre.',
        'AI_CREDENTIAL_KEY_MISSING',
        500
      );
    }
    if (hasStored) {
      throw fail(
        'Chave de criptografia de credenciais de IA ausente.',
        'AI_CREDENTIAL_KEY_MISSING',
        500
      );
    }
    return '';
  }

  function storedRow() {
    return one(
      `SELECT * FROM ai_provider_credentials
       WHERE provider=? AND status!='removed'
       ORDER BY updated_at DESC LIMIT 1`,
      PROVIDER
    ) || null;
  }

  function envApiKey() {
    const key = String((config && config.OPENAI_API_KEY) || '').trim();
    return key || '';
  }

  function resolveApiKey() {
    const row = storedRow();
    if (row) {
      const mk = requireMasterKey(true);
      const apiKey = decryptApiKey(row, mk);
      if (!apiKey) {
        throw fail(
          'Não foi possível recuperar a credencial do cofre.',
          'AI_CREDENTIAL_DECRYPT_FAILED',
          500
        );
      }
      return { apiKey, source: 'vault', row };
    }
    const envKey = envApiKey();
    if (envKey && config && config.AI_PROVIDER === 'openai') {
      return { apiKey: envKey, source: 'env', row: null };
    }
    return { apiKey: '', source: null, row: null };
  }

  function publicStatus() {
    const row = storedRow();
    const envKey = envApiKey();
    const envReady = !!(envKey && config && config.AI_PROVIDER === 'openai');
    let credentialConfigured = false;
    let credentialSource = null;
    if (row) {
      credentialConfigured = true;
      credentialSource = 'vault';
    } else if (envReady) {
      credentialConfigured = true;
      credentialSource = 'env';
    }
    const providerConfigured = credentialConfigured;
    return {
      provider: PROVIDER,
      display_model: 'GPT-5.6 Terra',
      provider_model: (config && config.AI_MODEL) || 'gpt-5.6-terra',
      provider_configured: providerConfigured,
      credential_configured: credentialConfigured,
      credential_source: credentialSource,
      credential_source_label: credentialSource === 'vault'
        ? 'Credencial configurada no Cofre'
        : (credentialSource === 'env'
          ? 'Credencial configurada pelo ambiente'
          : 'A Inteligência Artificial ainda não está configurada.'),
      last4: row ? (row.last4 || null) : null,
      last_tested_at: row ? (row.last_tested_at || null) : null,
      last_test_status: row ? (row.last_test_status || null) : null,
      status: providerConfigured ? 'configured' : 'not_configured',
      mask: credentialConfigured ? '••••••••••••' : null
    };
  }

  async function runProviderTest(apiKey) {
    if (typeof testConnection !== 'function') {
      throw fail('Teste de conexão indisponível.', 'AI_TEST_UNAVAILABLE', 500);
    }
    const key = String(apiKey || '').trim();
    if (!key) {
      throw fail('Informe a chave da API.', 'AI_CREDENTIAL_REQUIRED');
    }
    return testConnection({
      apiKey: key,
      model: (config && config.AI_MODEL) || 'gpt-5.6-terra',
      baseUrl: (config && config.OPENAI_BASE_URL) || 'https://api.openai.com/v1',
      timeoutMs: (config && config.AI_TIMEOUT_MS) || 30000
    });
  }

  async function testCredential(tenantId, userId, input = {}) {
    const status = publicStatus();
    let apiKey = String(input.api_key || input.apiKey || '').trim();
    let testingStored = false;
    if (!apiKey) {
      const resolved = resolveApiKey();
      apiKey = resolved.apiKey;
      testingStored = !!resolved.apiKey;
      if (!apiKey) {
        throw fail(
          'A Inteligência Artificial ainda não está configurada.',
          'AI_NOT_CONFIGURED',
          422
        );
      }
    }
    let ok = false;
    let errorCode = null;
    try {
      await runProviderTest(apiKey);
      ok = true;
    } catch (err) {
      errorCode = (err && err.code) || 'AI_PROVIDER_ERROR';
      ok = false;
    }

    if (testingStored) {
      const row = storedRow();
      if (row) {
        run(
          `UPDATE ai_provider_credentials
           SET last_tested_at=CURRENT_TIMESTAMP, last_test_status=?, updated_at=CURRENT_TIMESTAMP
           WHERE id=?`,
          ok ? 'success' : 'failed', row.id
        );
      }
    }

    audit(tenantId, userId, 'AI_CREDENTIAL_TESTED', {
      provider: PROVIDER,
      model: (config && config.AI_MODEL) || 'gpt-5.6-terra',
      success: ok,
      testing_stored: testingStored,
      error_code: errorCode
    });

    if (!ok) {
      throw fail(
        'Não foi possível validar a credencial. Verifique a chave e tente novamente.',
        errorCode || 'AI_CREDENTIAL_INVALID',
        422
      );
    }

    return {
      configured: true,
      provider: PROVIDER,
      model: (config && config.AI_MODEL) || 'gpt-5.6-terra',
      display_model: 'GPT-5.6 Terra',
      status: 'connected',
      message: 'Conexão com a OpenAI estabelecida.',
      credential_source: testingStored ? status.credential_source : 'pending'
    };
  }

  async function saveCredential(tenantId, userId, input = {}) {
    const apiKey = String(input.api_key || input.apiKey || '').trim();
    if (!apiKey || apiKey.length < 8) {
      throw fail('Informe uma chave de API válida.', 'AI_CREDENTIAL_REQUIRED');
    }
    const existing = storedRow();
    try {
      await runProviderTest(apiKey);
    } catch (err) {
      audit(tenantId, userId, 'AI_CREDENTIAL_TESTED', {
        provider: PROVIDER,
        success: false,
        operation: existing ? 'rotate' : 'create',
        error_code: (err && err.code) || 'AI_PROVIDER_ERROR'
      });
      throw fail(
        existing
          ? 'Não foi possível validar a credencial. A chave atual permanece inalterada.'
          : 'Não foi possível validar a credencial. Verifique a chave e tente novamente.',
        'AI_CREDENTIAL_INVALID',
        422
      );
    }

    const mk = requireMasterKey(false);
    if (!mk) {
      throw fail(
        'AI_CREDENTIAL_ENCRYPTION_KEY não configurada. Defina a master key no ambiente.',
        'AI_CREDENTIAL_KEY_MISSING',
        500
      );
    }
    if (config && config.IS_PROD && mk.length < 32) {
      throw fail(
        'AI_CREDENTIAL_ENCRYPTION_KEY fraca em produção (mínimo 32 caracteres).',
        'AI_CREDENTIAL_KEY_WEAK',
        500
      );
    }

    const enc = encryptApiKey(apiKey, mk);
    const last4 = last4Of(apiKey);
    const nowAction = existing ? 'AI_CREDENTIAL_ROTATED' : 'AI_CREDENTIAL_CREATED';

    if (existing) {
      run(
        `UPDATE ai_provider_credentials SET
           encrypted_api_key=?, key_iv=?, key_tag=?, key_salt=?,
           key_version=key_version+1, last4=?, status='configured',
           last_tested_at=CURRENT_TIMESTAMP, last_test_status='success',
           updated_at=CURRENT_TIMESTAMP, updated_by=?
         WHERE id=?`,
        enc.encrypted_api_key, enc.key_iv, enc.key_tag, enc.key_salt,
        last4, userId || null, existing.id
      );
    } else {
      run(
        `INSERT INTO ai_provider_credentials(
           id,provider,encrypted_api_key,key_iv,key_tag,key_salt,key_version,
           last4,status,last_tested_at,last_test_status,created_by,updated_by
         ) VALUES(?,?,?,?,?,?,1,?,'configured',CURRENT_TIMESTAMP,'success',?,?)`,
        id(), PROVIDER, enc.encrypted_api_key, enc.key_iv, enc.key_tag, enc.key_salt,
        last4, userId || null, userId || null
      );
    }

    audit(tenantId, userId, nowAction, {
      provider: PROVIDER,
      model: (config && config.AI_MODEL) || 'gpt-5.6-terra',
      success: true,
      last4
    });

    return {
      ...publicStatus(),
      message: 'Credencial configurada com sucesso.'
    };
  }

  function removeCredential(tenantId, userId) {
    const existing = storedRow();
    if (!existing) {
      return {
        ...publicStatus(),
        message: 'Nenhuma credencial no cofre para remover.'
      };
    }
    run('DELETE FROM ai_provider_credentials WHERE id=?', existing.id);
    audit(tenantId, userId, 'AI_CREDENTIAL_REMOVED', {
      provider: PROVIDER,
      success: true
    });
    return {
      ...publicStatus(),
      message: 'Credencial removida do cofre.'
    };
  }

  function assertNoSecretLeak(value) {
    const blob = typeof value === 'string' ? value : JSON.stringify(value || {});
    if (/sk-[a-zA-Z0-9_\-]{10,}/.test(blob)) {
      throw fail('Resposta bloqueada: possível vazamento de segredo.', 'SECRET_LEAK', 500);
    }
    return value;
  }

  return {
    PROVIDER,
    resolveApiKey,
    publicStatus,
    testCredential,
    saveCredential,
    removeCredential,
    storedRow,
    assertNoSecretLeak
  };
}

module.exports = { createAiCredentialService, PROVIDER };
