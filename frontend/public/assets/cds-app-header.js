/* Sprint 28.3 — CdsAppHeader (cabeçalho compartilhado OFFICE/CLIENT) */
(function (global) {
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
  }

  function bellSvg() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"/><path d="M9.5 17a2.5 2.5 0 0 0 5 0"/></svg>';
  }

  function helpSvg() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1.8-1.1 1.8"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/></svg>';
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    return ((parts[0][0] || '') + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function notifHtml(unread) {
    const n = Number(unread || 0) || 0;
    return `<div class="notif-wrap" id="notifWrap"><button type="button" class="icon-button notif-bell" id="notifToggle" aria-label="${n ? `Notificações (${n})` : 'Notificações'}">${bellSvg()}${n ? `<span class="notif-badge" id="notifBadge">${n}</span>` : '<span class="notif-badge" id="notifBadge" hidden></span>'}</button><div class="notif-panel" id="notifPanel" hidden><div class="notif-head"><strong id="notifLabel">Notificações${n ? ` (${n})` : ''}</strong><button type="button" class="btn secondary" id="notifReadAll">Marcar todas</button></div><div id="notifList" class="notif-list"><div class="empty-state"><h3>Carregando avisos</h3><p>Buscando notificações.</p></div></div></div></div>`;
  }

  /**
   * @param {object} opts
   * @param {'OFFICE'|'CLIENT'} opts.mode
   * @param {string} opts.eyebrow
   * @param {string} opts.title
   * @param {string} opts.searchPlaceholder
   * @param {string} opts.userName
   * @param {string} opts.userRole
   * @param {number} [opts.unread]
   * @param {boolean} [opts.showMenu]
   * @param {boolean} [opts.showHelp]
   */
  function render(opts) {
    const o = opts || {};
    const unread = Number(o.unread || 0) || 0;
    const searchPh = esc(o.searchPlaceholder || 'Pesquisar...');
    const showHelp = o.showHelp !== false;
    const showMenu = o.showMenu !== false;
    return `<header class="top cds-app-header" data-portal="${esc(o.mode || 'CLIENT')}">
      <div class="breadcrumb"><span>${esc(o.eyebrow || 'EMPRESA ATIVA')}</span><strong>${esc(o.title || '')}</strong></div>
      <div class="top-search"><label class="sr-only" for="globalSearch">Pesquisa</label><span class="cds-search-ico" aria-hidden="true">⌕</span><input id="globalSearch" class="search-input" placeholder="${searchPh}" autocomplete="off"></div>
      <div class="top-actions top-user">
        ${notifHtml(unread)}
        ${showHelp ? `<button type="button" class="icon-button" id="helpBtn" aria-label="Ajuda" title="Ajuda">${helpSvg()}</button>` : ''}
        ${showMenu ? `<div class="user-menu" id="userMenu"><button type="button" class="user-chip" id="userMenuBtn" aria-haspopup="true" aria-expanded="false"><div class="top-avatar">${esc(initials(o.userName))}</div><span>${esc(o.userName || '')}<small>${esc(o.userRole || '')}</small></span></button><div class="user-dropdown" id="userDropdown" hidden><button type="button" id="goProfile">Perfil</button><button type="button" id="logoutTop">Sair</button></div></div>` : ''}
      </div>
    </header>`;
  }

  global.CdsAppHeader = { render, notifHtml, initials, esc };
})(typeof window !== 'undefined' ? window : globalThis);
