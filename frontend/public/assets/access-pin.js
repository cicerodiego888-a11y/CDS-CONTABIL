'use strict';

(function (global) {
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
  }

  function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 4);
  }

  function isValidPin(value) {
    return /^\d{4}$/.test(String(value || ''));
  }

  /**
   * Renderiza o formulário de cadastro/alteração de PIN.
   * mode: 'setup' | 'change'
   */
  function formHtml(opts) {
    opts = opts || {};
    const mode = opts.mode || 'setup';
    const title = opts.title || (mode === 'change' ? 'Alterar PIN de acesso' : 'Crie seu PIN de acesso');
    const lead = opts.lead || (mode === 'change'
      ? 'Informe o PIN atual e escolha um novo código de 4 dígitos.'
      : 'O PIN é um código de 4 dígitos que você poderá usar para acessar rapidamente sua conta.');
    const submit = opts.submitLabel || (mode === 'change' ? 'Salvar novo PIN' : 'Cadastrar PIN');
    const current = mode === 'change'
      ? `<div class="field"><label for="pinCurrent">PIN atual</label><input id="pinCurrent" name="current_pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required></div>`
      : '';
    const forgot = mode === 'change' || opts.showForgot
      ? `<p class="muted" style="margin-top:12px"><a href="#" id="pinForgotLink">Esqueci meu PIN</a></p>`
      : '';
    return `
      <div class="cds-pin-step" id="cdsPinStep">
        <h1>${esc(title)}</h1>
        <p>${esc(lead)}</p>
        <form id="cdsPinForm" autocomplete="off">
          ${current}
          <div class="field"><label for="pinValue">PIN de acesso</label>
            <input id="pinValue" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required>
          </div>
          <div class="field"><label for="pinConfirm">Confirmar PIN</label>
            <input id="pinConfirm" name="confirmation" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required>
          </div>
          <small>O PIN deve ter exatamente 4 números.</small>
          <button type="submit" id="cdsPinSubmit">${esc(submit)}</button>
        </form>
        ${forgot}
        <div id="cdsPinMessage"></div>
      </div>`;
  }

  function bindInputs(root) {
    root = root || document;
    ['pinCurrent', 'pinValue', 'pinConfirm'].forEach(id => {
      const el = root.querySelector('#' + id);
      if (!el) return;
      el.addEventListener('input', () => {
        el.value = digitsOnly(el.value);
      });
    });
  }

  function bindForm(root, options) {
    options = options || {};
    const form = root.querySelector('#cdsPinForm');
    const message = root.querySelector('#cdsPinMessage');
    const submitBtn = root.querySelector('#cdsPinSubmit');
    bindInputs(root);

    const forgot = root.querySelector('#pinForgotLink');
    if (forgot) {
      forgot.onclick = async e => {
        e.preventDefault();
        if (typeof options.onForgot === 'function') return options.onForgot();
        try {
          if (options.api) {
            const r = await options.api('/auth/pin/reset-request', { method: 'POST', body: '{}' });
            if (message) {
              message.className = 'ok';
              message.textContent = (r && r.message) || 'Use a recuperação de conta para definir nova senha e um novo PIN.';
            }
          }
        } catch (err) {
          if (message) {
            message.className = 'error';
            message.textContent = err.message || 'Não foi possível iniciar a recuperação.';
          }
        }
      };
    }

    if (!form) return;
    form.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const pin = String(fd.get('pin') || '');
      const confirmation = String(fd.get('confirmation') || '');
      const current_pin = fd.get('current_pin') != null ? String(fd.get('current_pin') || '') : undefined;
      if (!isValidPin(pin)) {
        if (message) {
          message.className = 'error';
          message.textContent = 'O PIN deve ter exatamente 4 números.';
        }
        return;
      }
      if (pin !== confirmation) {
        if (message) {
          message.className = 'error';
          message.textContent = 'A confirmação do PIN não confere.';
        }
        return;
      }
      if (current_pin !== undefined && !isValidPin(current_pin)) {
        if (message) {
          message.className = 'error';
          message.textContent = 'Informe o PIN atual com 4 números.';
        }
        return;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Salvando...';
      }
      try {
        const body = { pin, confirmation };
        if (current_pin !== undefined) body.current_pin = current_pin;
        const result = await options.api('/auth/pin', {
          method: 'POST',
          body: JSON.stringify(body)
        });
        if (message) {
          message.className = 'ok';
          message.textContent = (result && result.message) || 'PIN cadastrado com sucesso.';
        }
        if (typeof options.onSuccess === 'function') {
          await options.onSuccess(result);
        }
      } catch (err) {
        if (message) {
          message.className = 'error';
          message.textContent = err.message || 'Não foi possível cadastrar o PIN.';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = options.submitLabel || 'Cadastrar PIN';
        }
      }
    };
  }

  function mountBlocking(container, options) {
    container.innerHTML = formHtml({
      mode: 'setup',
      showForgot: !!options.showForgot,
      title: options.title,
      lead: options.lead,
      submitLabel: options.submitLabel
    });
    bindForm(container, options);
  }

  global.CdsAccessPin = {
    formHtml,
    bindForm,
    bindInputs,
    mountBlocking,
    isValidPin,
    digitsOnly
  };
})(typeof window !== 'undefined' ? window : global);
