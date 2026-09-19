'use strict';
/**
 * Adiciona "Ver senha" / "Ocultar" em todo input[type=password].
 * Observa o DOM para cobrir telas e modais dinâmicos.
 */
(function (global) {
  function enhance(input) {
    if (!input || input.nodeType !== 1) return;
    if (input.dataset.pwToggle === '1') return;
    if (input.closest('.pw-field')) {
      input.dataset.pwToggle = '1';
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'pw-field';
    const parent = input.parentNode;
    if (!parent) return;
    parent.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.dataset.pwToggle = '1';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'Ver senha');
    btn.textContent = 'Ver';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Ocultar' : 'Ver';
      btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Ver senha');
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    });
    wrap.appendChild(btn);
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('input[type="password"]').forEach(enhance);
  }

  function start() {
    scan(document);
    if (!document.body) return;
    const mo = new MutationObserver(function (muts) {
      for (let i = 0; i < muts.length; i++) {
        const nodes = muts[i].addedNodes;
        for (let j = 0; j < nodes.length; j++) {
          const n = nodes[j];
          if (!n || n.nodeType !== 1) continue;
          if (n.matches && n.matches('input[type="password"]')) enhance(n);
          if (n.querySelectorAll) n.querySelectorAll('input[type="password"]').forEach(enhance);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  global.CdsPasswordToggle = { bind: scan, enhance: enhance };
})(typeof window !== 'undefined' ? window : globalThis);
