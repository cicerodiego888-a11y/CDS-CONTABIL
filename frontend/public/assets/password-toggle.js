'use strict';
/**
 * Adiciona botão de olho (mostrar/ocultar) em todo input[type=password].
 * Observa o DOM para cobrir telas e modais dinâmicos.
 */
(function (global) {
  var EYE = '<svg class="pw-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg class="pw-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.3 21.3 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="m1 1 22 22"/></svg>';

  function setIcon(btn, showPlain) {
    btn.innerHTML = showPlain ? EYE_OFF : EYE;
    btn.setAttribute('aria-label', showPlain ? 'Ocultar senha' : 'Mostrar senha');
    btn.setAttribute('title', showPlain ? 'Ocultar senha' : 'Mostrar senha');
  }

  function enhance(input) {
    if (!input || input.nodeType !== 1) return;
    if (input.dataset.pwToggle === '1') return;
    if (input.closest('.pw-field')) {
      input.dataset.pwToggle = '1';
      return;
    }
    // Login já tem botão próprio (#togglePassword)
    if (input.id === 'password' && input.closest('.login-password')) {
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
    setIcon(btn, false);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      setIcon(btn, show);
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
