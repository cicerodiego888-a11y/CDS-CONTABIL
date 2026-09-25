'use strict';

/**
 * CdsBackNav — navegação de retorno central do CDS Contábil Connect.
 *
 * Prioridade: stack (contexto) → fallback do módulo → rota segura.
 * Não usa history.back() cego. Não altera rotas/APIs.
 */
(function (global) {
  var MAX_STACK = 32;
  var stack = [];
  var lastKey = null;

  var ROOT_PAGES = {
    dashboard: 1,
    empresas: 1,
    despesas: 1,
    receitas: 1,
    documentos: 1,
    solicitacoes: 1,
    processos: 1,
    pendencias: 1,
    classificacao: 1,
    aprovacao: 1,
    lancamentos: 1,
    importacoes: 1,
    exportacoes: 1,
    fechamento: 1,
    integracoes: 1,
    plano: 1,
    categorias: 1,
    bancos: 1,
    regras: 1,
    usuarios: 1,
    comunicacoes: 1,
    ia: 1,
    configuracoes: 1,
    auditoria: 1
  };

  var PARENT_FALLBACK = {
    companyView: 'empresas',
    companyUsers: 'empresas',
    requestView: 'solicitacoes',
    processView: 'processos',
    fechamentoId: 'fechamento',
    settingsSection: 'configuracoes',
    ia: 'configuracoes',
    usuarios: 'configuracoes',
    comunicacoes: 'configuracoes',
    auditoria: 'configuracoes',
    detail: 'expenses',
    requestConversation: 'requests'
  };

  function clone(obj) {
    if (!obj || typeof obj !== 'object') return obj == null ? null : obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return null;
    }
  }

  function snapshot(state, meta) {
    meta = meta || {};
    return {
      page: state.page || null,
      selectedCompanyId: state.selectedCompany && state.selectedCompany.id || null,
      requestView: state.requestView || null,
      processView: state.processView || null,
      companyView: state.companyView || null,
      companyUsers: state.companyUsers || null,
      fechamentoId: state.fechamentoId || null,
      settingsSection: state.settingsSection || 'geral',
      listPage: clone(state.listPage),
      docFilters: clone(state.docFilters),
      entryFilters: clone(state.entryFilters),
      classifFilters: clone(state.classifFilters),
      approvalFilters: clone(state.approvalFilters),
      companySearch: state.companySearch || '',
      companyStatus: state.companyStatus || '',
      companyPage: state.companyPage || 1,
      processSearch: state.processSearch || '',
      processOccurrenceFilter: clone(state.processOccurrenceFilter),
      portalFilters: clone(state.filters),
      fallbackPage: meta.fallbackPage || state.page || 'dashboard',
      label: meta.label || null,
      kind: meta.kind || null,
      ts: Date.now()
    };
  }

  function frameKey(frame) {
    return [
      frame.page,
      frame.selectedCompanyId || '',
      frame.requestView || '',
      frame.processView || '',
      frame.companyView || '',
      frame.companyUsers || '',
      frame.fechamentoId || '',
      frame.settingsSection || '',
      frame.kind || ''
    ].join('|');
  }

  function isSecondary(state) {
    if (!state) return false;
    return !!(
      state.requestView ||
      state.processView ||
      state.companyView ||
      state.companyUsers ||
      state.fechamentoId ||
      (state.page === 'configuracoes' && state.settingsSection && state.settingsSection !== 'geral')
    );
  }

  function remember(state, meta) {
    if (!state) return null;
    var frame = snapshot(state, meta || {});
    var key = frameKey(frame);
    if (key === lastKey) return frame;
    stack.push(frame);
    lastKey = key;
    if (stack.length > MAX_STACK) stack.shift();
    return frame;
  }

  function peek() {
    return stack.length ? stack[stack.length - 1] : null;
  }

  function clear() {
    stack = [];
    lastKey = null;
  }

  function depth() {
    return stack.length;
  }

  function canBack(state) {
    if (stack.length) return true;
    return isSecondary(state);
  }

  function shouldShow(state) {
    return canBack(state);
  }

  function buttonHtml(id, label) {
    var text = label || '← Voltar';
    return (
      '<button type="button" class="btn secondary cds-back-btn" id="' +
      (id || 'cdsBack') +
      '" data-cds-back="1">' +
      text +
      '</button>'
    );
  }

  function clearSecondary(state) {
    if (!state) return;
    state.requestView = null;
    state.activeRequestId = null;
    state.processView = null;
    state.companyView = null;
    state.companyUsers = null;
    state.fechamentoId = null;
  }

  function applyFilters(state, frame) {
    if (!state || !frame) return;
    if (frame.listPage) state.listPage = clone(frame.listPage);
    if (frame.docFilters) state.docFilters = clone(frame.docFilters);
    if (frame.entryFilters) state.entryFilters = clone(frame.entryFilters);
    if (frame.classifFilters) state.classifFilters = clone(frame.classifFilters);
    if (frame.approvalFilters) state.approvalFilters = clone(frame.approvalFilters);
    if (frame.companySearch != null) state.companySearch = frame.companySearch;
    if (frame.companyStatus != null) state.companyStatus = frame.companyStatus;
    if (frame.companyPage != null) state.companyPage = frame.companyPage;
    if (frame.processSearch != null) state.processSearch = frame.processSearch;
    if (frame.processOccurrenceFilter) state.processOccurrenceFilter = clone(frame.processOccurrenceFilter);
    if (frame.portalFilters && state.filters) state.filters = clone(frame.portalFilters);
    if (frame.settingsSection) state.settingsSection = frame.settingsSection;
  }

  function resolveFallback(state, explicit) {
    if (explicit) return explicit;
    if (state) {
      if (state.companyView) return PARENT_FALLBACK.companyView;
      if (state.companyUsers) return PARENT_FALLBACK.companyUsers;
      if (state.requestView) return PARENT_FALLBACK.requestView;
      if (state.processView) return PARENT_FALLBACK.processView;
      if (state.fechamentoId) return PARENT_FALLBACK.fechamentoId;
      if (state.page && PARENT_FALLBACK[state.page] && stack.length) {
        return PARENT_FALLBACK[state.page];
      }
      if (state.page && ROOT_PAGES[state.page]) return state.page;
    }
    return 'dashboard';
  }

  /**
   * @param {object} opts
   * @param {object} opts.state
   * @param {string} [opts.fallbackPage]
   * @param {function} [opts.clear] — limpa flags secundárias do host
   * @param {function} [opts.after] — re-render após restauração
   * @param {function} [opts.syncHistory] — (url|null) => void
   * @param {function} [opts.ensureCompany] — async (companyId) => void
   */
  function back(opts) {
    opts = opts || {};
    var state = opts.state;
    if (!state) return { ok: false, source: 'no_state' };

    var frame = stack.pop() || null;
    lastKey = stack.length ? frameKey(stack[stack.length - 1]) : null;

    if (typeof opts.clear === 'function') opts.clear();
    else clearSecondary(state);

    if (frame) {
      applyFilters(state, frame);
      state.page = frame.page || resolveFallback(state, opts.fallbackPage);

      // Voltar para listagem: nunca restaura flags secundárias do destino
      clearSecondary(state);
      if (frame.settingsSection && state.page === 'configuracoes') {
        state.settingsSection = frame.settingsSection;
      } else if (state.page === 'configuracoes') {
        state.settingsSection = 'geral';
      }

      var companyId = frame.selectedCompanyId || null;
      if (!companyId && (frame.page === 'empresas' || frame.kind === 'companyView' || frame.kind === 'companyUsers')) {
        state.selectedCompany = null;
      }

      var done = function () {
        if (typeof opts.syncHistory === 'function') {
          if (companyId) {
            opts.syncHistory('/empresas/' + companyId);
          } else if (!companyId && (frame.page === 'empresas' || !state.selectedCompany)) {
            opts.syncHistory('/');
          }
        }
        if (typeof opts.after === 'function') opts.after({ source: 'stack', frame: frame });
      };

      if (companyId && typeof opts.ensureCompany === 'function') {
        var p = opts.ensureCompany(companyId);
        if (p && typeof p.then === 'function') {
          return p.then(function () {
            done();
            return { ok: true, source: 'stack', frame: frame };
          });
        }
      } else if (!companyId) {
        // Mantém selectedCompany se o frame também tinha; se frame sem empresa, limpa
        if (!frame.selectedCompanyId) {
          /* host may clear via ensureCompany absence — leave to after/sync */
        }
      }

      done();
      return { ok: true, source: 'stack', frame: frame };
    }

    // Sem stack — deep link / refresh: fallback do módulo
    var fallback = resolveFallback(state, opts.fallbackPage);
    clearSecondary(state);
    state.page = fallback;
    if (fallback === 'configuracoes') state.settingsSection = 'geral';
    if (typeof opts.syncHistory === 'function') {
      if (state.selectedCompany && state.selectedCompany.id) {
        opts.syncHistory('/empresas/' + state.selectedCompany.id);
      } else {
        opts.syncHistory('/');
      }
    }
    if (typeof opts.after === 'function') {
      opts.after({ source: 'fallback', fallbackPage: fallback });
    }
    return { ok: true, source: 'fallback', fallbackPage: fallback };
  }

  function bind(id, opts) {
    var el =
      typeof id === 'string'
        ? (typeof document !== 'undefined' && document.getElementById(id)) || null
        : id;
    if (!el) return false;
    el.onclick = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      back(opts);
    };
    return true;
  }

  global.CdsBackNav = {
    ROOT_PAGES: ROOT_PAGES,
    PARENT_FALLBACK: PARENT_FALLBACK,
    remember: remember,
    peek: peek,
    clear: clear,
    depth: depth,
    canBack: canBack,
    shouldShow: shouldShow,
    isSecondary: isSecondary,
    buttonHtml: buttonHtml,
    clearSecondary: clearSecondary,
    back: back,
    bind: bind,
    snapshot: snapshot,
    /** test helper */
    _stack: function () {
      return stack.slice();
    },
    _resetForTests: function () {
      clear();
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.CdsBackNav;
  }
})(typeof window !== 'undefined' ? window : global);
