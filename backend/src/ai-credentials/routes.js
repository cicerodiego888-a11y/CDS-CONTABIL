'use strict';

const { createAiCredentialService } = require('./service');

function sanitizeBody(body) {
  const out = Object.assign({}, body || {});
  delete out.tenant_id;
  delete out.company_id;
  delete out.origin;
  delete out.confidence;
  delete out.OPENAI_API_KEY;
  delete out.AI_CREDENTIAL_ENCRYPTION_KEY;
  delete out.encrypted_api_key;
  return out;
}

function mountAiCredentialRoutes(app, deps) {
  const {
    db, id, auth, role, deny, auditSystem, config, testConnection, onCredentialChanged
  } = deps;
  const service = createAiCredentialService({
    db, id, auditSystem, config, testConnection
  });
  const admin = role('OWNER', 'ACCOUNTANT');
  const office = role('OWNER', 'ACCOUNTANT', 'STAFF');

  function handle(error, res) {
    const message = (error && error.message) || 'Não foi possível concluir a operação.';
    const safe = /sk-|Authorization|Bearer |api[_-]?key/i.test(message)
      ? 'Não foi possível validar a credencial. Verifique a chave e tente novamente.'
      : message;
    return deny(
      res,
      error && error.http || 500,
      safe,
      error && error.code || 'AI_CREDENTIAL_ERROR'
    );
  }

  function notifyChange() {
    if (typeof onCredentialChanged === 'function') {
      try { onCredentialChanged(); } catch { /* ignore refresh errors */ }
    }
  }

  app.get('/api/ai/credentials', auth, office, (req, res) => {
    try {
      res.json(service.assertNoSecretLeak(service.publicStatus()));
    } catch (error) { handle(error, res); }
  });

  app.post('/api/ai/credentials/test', auth, admin, async (req, res) => {
    try {
      const body = sanitizeBody(req.body);
      const result = await service.testCredential(req.user.tenant_id, req.user.sub, body);
      res.json(service.assertNoSecretLeak(result));
    } catch (error) { handle(error, res); }
  });

  app.put('/api/ai/credentials', auth, admin, async (req, res) => {
    try {
      const body = sanitizeBody(req.body);
      const result = await service.saveCredential(req.user.tenant_id, req.user.sub, body);
      notifyChange();
      res.json(service.assertNoSecretLeak(result));
    } catch (error) { handle(error, res); }
  });

  app.delete('/api/ai/credentials', auth, admin, (req, res) => {
    try {
      const result = service.removeCredential(req.user.tenant_id, req.user.sub);
      notifyChange();
      res.json(service.assertNoSecretLeak(result));
    } catch (error) { handle(error, res); }
  });

  // Alias em português
  app.get('/api/ia/credenciais', auth, office, (req, res) => {
    try { res.json(service.assertNoSecretLeak(service.publicStatus())); }
    catch (error) { handle(error, res); }
  });

  return service;
}

module.exports = { mountAiCredentialRoutes };
