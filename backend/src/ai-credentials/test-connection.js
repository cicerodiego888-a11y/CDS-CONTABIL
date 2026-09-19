'use strict';

/**
 * Validação mínima da chave OpenAI via GET /v1/models.
 * Não passa pelo fluxo de negócio (classificação / visual) e não grava usage.
 */
async function testOpenAiConnection(options = {}) {
  const apiKey = String(options.apiKey || '').trim();
  const baseUrl = String(options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 30000));
  const fetchImpl = options.fetchImpl || global.fetch;

  if (!apiKey) {
    const error = new Error('Informe a chave da API.');
    error.code = 'AI_CREDENTIAL_REQUIRED';
    throw error;
  }
  if (!fetchImpl) {
    const error = new Error('Cliente HTTP indisponível.');
    error.code = 'AI_PROVIDER_ERROR';
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(baseUrl + '/models', {
      method: 'GET',
      signal: controller.signal,
      headers: { Authorization: 'Bearer ' + apiKey }
    });
  } catch (cause) {
    const error = new Error('Não foi possível conectar ao provedor.');
    error.code = cause && cause.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR';
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    const error = new Error('Credencial rejeitada pelo provedor.');
    error.code = 'AI_CREDENTIAL_INVALID';
    error.http = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error('Provedor indisponível.');
    error.code = 'AI_PROVIDER_ERROR';
    error.http = response.status;
    throw error;
  }
  return { ok: true, provider: 'openai', model: options.model || 'gpt-5.6-terra' };
}

module.exports = { testOpenAiConnection };
