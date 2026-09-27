(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CdsAccountCombobox = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function normalizeSearch(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function isPostableAccount(account) {
    if (!account) return false;
    if (account.active === 0 || account.active === false) return false;
    return !!(account.is_postable === 1 || account.is_postable === true);
  }

  function selectableAccounts(accounts) {
    return (accounts || []).filter(isPostableAccount);
  }

  function accountCode(account) {
    return String((account && (account.account_code != null ? account.account_code : account.code)) || '');
  }

  function accountClassification(account) {
    return String((account && (account.classification_code != null ? account.classification_code : account.classification)) || '');
  }

  function accountDescription(account) {
    return String((account && account.description) || '');
  }

  function formatAccountLabel(account) {
    return [
      accountCode(account),
      accountClassification(account),
      accountDescription(account)
    ].join(' | ');
  }

  function accountSearchText(account) {
    return normalizeSearch([
      accountCode(account),
      accountClassification(account),
      accountDescription(account)
    ].join(' '));
  }

  function filterAccounts(accounts, query) {
    const list = selectableAccounts(accounts);
    const q = normalizeSearch(query);
    if (!q) return list.slice();
    return list.filter((account) => accountSearchText(account).includes(q));
  }

  function findAccountById(accounts, id) {
    if (!id) return null;
    return (accounts || []).find((account) => String(account.id) === String(id)) || null;
  }

  function nextActiveIndex(current, key, length) {
    if (!length) return -1;
    if (key === 'ArrowDown') {
      if (current < 0) return 0;
      return Math.min(length - 1, current + 1);
    }
    if (key === 'ArrowUp') {
      if (current < 0) return length - 1;
      return Math.max(0, current - 1);
    }
    return current;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function el(doc, tag, attrs, children) {
    const node = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        const val = attrs[key];
        if (val == null || val === false) return;
        if (key === 'className') node.className = val;
        else if (key === 'text') node.textContent = val;
        else if (key === 'html') node.innerHTML = val;
        else if (key === 'hidden') node.hidden = !!val;
        else node.setAttribute(key, val === true ? '' : String(val));
      });
    }
    (children || []).forEach((child) => {
      if (child == null) return;
      node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
    });
    return node;
  }

  function mount(host, options) {
    const opts = options || {};
    const doc = opts.document || (typeof document !== 'undefined' ? document : null);
    if (!doc) throw new Error('document is required');
    const accounts = opts.accounts || [];
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    const fetchHook = typeof opts.fetchHook === 'function' ? opts.fetchHook : null;
    const now = typeof opts.now === 'function' ? opts.now : Date.now;

    while (host.firstChild) host.removeChild(host.firstChild);

    const root = el(doc, 'div', { className: 'account-combo' });
    const hidden = el(doc, 'input', { type: 'hidden', className: 'account-combo-value', value: '' });
    const input = el(doc, 'input', {
      type: 'text',
      className: 'account-combo-input',
      placeholder: 'Digite código ou nome...',
      autocomplete: 'off',
      spellcheck: 'false',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': 'false'
    });
    const panel = el(doc, 'div', { className: 'account-combo-panel', hidden: true }, [
      el(doc, 'div', { className: 'account-combo-head' }, [
        el(doc, 'span', { text: 'Código' }),
        el(doc, 'span', { text: 'Classificação' }),
        el(doc, 'span', { text: 'Descrição' })
      ])
    ]);
    const listEl = el(doc, 'div', { className: 'account-combo-list', role: 'listbox' });
    panel.appendChild(listEl);
    root.appendChild(hidden);
    root.appendChild(input);
    root.appendChild(panel);
    host.appendChild(root);

    let open = false;
    let active = -1;
    let visible = [];
    let selectedId = opts.value ? String(opts.value) : '';
    let suppressBlur = false;
    let inputIdentity = input;

    function setSelected(account, syncInput) {
      selectedId = account ? String(account.id) : '';
      hidden.value = selectedId;
      if (syncInput !== false) {
        input.value = account ? formatAccountLabel(account) : '';
      }
      onChange(selectedId, account || null);
    }

    function paintList() {
      while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
      if (!visible.length) {
        listEl.appendChild(el(doc, 'div', { className: 'account-combo-empty muted', text: 'Nenhuma conta encontrada.' }));
        return;
      }
      visible.forEach((account, index) => {
        const btn = el(doc, 'button', {
          type: 'button',
          className: 'account-combo-option' + (index === active ? ' is-active' : ''),
          role: 'option',
          'data-i': String(index),
          'data-id': String(account.id)
        }, [
          el(doc, 'span', { className: 'account-combo-code', text: accountCode(account) }),
          el(doc, 'span', { className: 'account-combo-class', text: accountClassification(account) }),
          el(doc, 'span', { className: 'account-combo-desc', text: accountDescription(account) })
        ]);
        btn.addEventListener('mousedown', function (event) {
          event.preventDefault();
          suppressBlur = true;
        });
        btn.addEventListener('click', function () {
          setSelected(account, true);
          closePanel();
          if (typeof input.focus === 'function') input.focus();
        });
        listEl.appendChild(btn);
      });
    }

    function refresh(query) {
      if (fetchHook) fetchHook(query);
      visible = filterAccounts(accounts, query);
      if (active >= visible.length) active = visible.length ? visible.length - 1 : -1;
      if (active < 0 && visible.length) active = 0;
      paintList();
    }

    function openPanel() {
      open = true;
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      const current = findAccountById(accounts, selectedId);
      const q = current && input.value === formatAccountLabel(current) ? '' : input.value;
      refresh(q);
    }

    function closePanel() {
      open = false;
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }

    if (selectedId) {
      const current = findAccountById(accounts, selectedId);
      if (current && isPostableAccount(current)) setSelected(current, true);
      else setSelected(null, true);
    } else {
      hidden.value = '';
    }

    input.addEventListener('focus', function () {
      openPanel();
    });

    input.addEventListener('input', function () {
      if (selectedId) {
        const current = findAccountById(accounts, selectedId);
        if (!current || input.value !== formatAccountLabel(current)) {
          selectedId = '';
          hidden.value = '';
          onChange('', null);
        }
      }
      if (!open) openPanel();
      else refresh(input.value);
      // Keep the same input instance focused during local filtering.
      if (doc.activeElement !== input && typeof input.focus === 'function') input.focus();
      if (input !== inputIdentity) throw new Error('account combobox input was replaced during search');
    });

    input.addEventListener('keydown', function (event) {
      const key = event.key;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        if (!open) openPanel();
        active = nextActiveIndex(active, key, visible.length);
        paintList();
        return;
      }
      if (key === 'Enter') {
        if (open && visible.length && active >= 0) {
          event.preventDefault();
          setSelected(visible[active], true);
          closePanel();
        }
        return;
      }
      if (key === 'Escape') {
        if (open) {
          event.preventDefault();
          if (typeof event.stopPropagation === 'function') event.stopPropagation();
          closePanel();
          const current = findAccountById(accounts, selectedId);
          input.value = current ? formatAccountLabel(current) : '';
          if (typeof input.focus === 'function') input.focus();
        }
      }
    });

    input.addEventListener('blur', function () {
      const started = now();
      setTimeout(function () {
        if (suppressBlur) {
          suppressBlur = false;
          if (typeof input.focus === 'function') input.focus();
          return;
        }
        closePanel();
        const current = findAccountById(accounts, selectedId);
        input.value = current ? formatAccountLabel(current) : '';
      }, 120);
      void started;
    });

    return {
      getValue: function () { return hidden.value; },
      setValue: function (id) {
        const account = findAccountById(accounts, id);
        if (account && isPostableAccount(account)) setSelected(account, true);
        else setSelected(null, true);
      },
      getInput: function () { return input; },
      getPanel: function () { return panel; },
      getList: function () { return listEl; },
      isOpen: function () { return open; },
      getVisible: function () { return visible.slice(); },
      getActiveIndex: function () { return active; },
      close: closePanel,
      open: openPanel,
      destroy: function () {
        while (host.firstChild) host.removeChild(host.firstChild);
      }
    };
  }

  return {
    normalizeSearch,
    isPostableAccount,
    selectableAccounts,
    formatAccountLabel,
    filterAccounts,
    findAccountById,
    nextActiveIndex,
    escapeHtml,
    mount
  };
});
