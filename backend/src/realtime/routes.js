'use strict';

const hub = require('./hub');

/**
 * Auth for EventSource: Authorization header, cds_session cookie, or ?token=
 * (EventSource cannot set custom headers.)
 */
function mountRealtimeRoutes(app, deps) {
  const { auth, deny, jwt, SECRET, sessions } = deps;

  function authStream(req, res, next) {
    try {
      let token = '';
      const h = req.headers.authorization || '';
      if (h.startsWith('Bearer ')) token = h.slice(7);
      if (!token) {
        const cookie = String(req.headers.cookie || '');
        const m = cookie.match(/(?:^|;\s*)cds_session=([^;]+)/);
        if (m) token = decodeURIComponent(m[1]);
      }
      if (!token && req.query && req.query.token) {
        token = String(req.query.token || '').trim();
      }
      if (!token) return deny(res, 401, 'Autenticação obrigatória.', 'AUTH_REQUIRED');
      req.user = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
      const sess = sessions.verifyAccess(req.user);
      if (!sess.ok) {
        return deny(res, 401, 'Sessão inválida.', sess.code || 'INVALID_TOKEN');
      }
      next();
    } catch (err) {
      if (err && err.name === 'TokenExpiredError') {
        return deny(res, 401, 'Sua sessão expirou. Entre novamente para continuar.', 'TOKEN_EXPIRED');
      }
      return deny(res, 401, 'Sessão inválida.', 'INVALID_TOKEN');
    }
  }

  app.get('/api/realtime/stream', authStream, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, user_id: req.user.sub })}\n\n`);

    const unsubscribe = hub.subscribe(req.user.sub, res);
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* closed */ }
    }, 25000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', cleanup);
    req.on('aborted', cleanup);
  });

  // Optional: keep auth unused warning away if passed
  void auth;

  return hub;
}

module.exports = { mountRealtimeRoutes, hub };
