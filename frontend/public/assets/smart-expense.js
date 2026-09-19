'use strict';

(function (global) {
  const payOptions = [
    ['PIX', 'PIX'],
    ['DINHEIRO', 'Dinheiro'],
    ['DEBITO', 'Cartão de débito'],
    ['CREDITO', 'Cartão de crédito'],
    ['TRANSFERENCIA', 'Transferência'],
    ['BOLETO', 'Boleto'],
    ['OUTRO', 'Outro']
  ];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
  }

  function fieldHint(field) {
    if (!field || field.status === 'empty') return '';
    if (field.status === 'identified') {
      return '<span class="se-hint ok">✓ Identificado</span>';
    }
    if (field.needs_review) {
      return '<span class="se-hint warn">⚠ Revisar</span>';
    }
    return '<span class="se-hint warn">⚠ Confirme</span>';
  }

  function originHint(field) {
    if (!field || !field.value) return '';
    if (field.origin === 'AI_VISUAL' || field.origin === 'AI') {
      return '<small class="se-origin">Preenchido pela IA</small>';
    }
    if (field.origin === 'EXTRACTION_ENGINE' || field.origin === 'CLASSIFICATION_ENGINE') {
      return '<small class="se-origin">Preenchido pelo CDS</small>';
    }
    if (field.origin === 'MANUAL') {
      return '<small class="se-origin">Informado manualmente</small>';
    }
    return '';
  }

  function open(options) {
    const {
      mode = 'office',
      token,
      companyId,
      companyName,
      categories = [],
      banks = [],
      api,
      toast,
      onSaved,
      onClose,
      uploadUrl,
      analyzeUrl,
      reanalyzeUrl,
      saveUrl,
      viewUrlFor,
      authHeaders
    } = options;

    let documentId = null;
    let documentMeta = null;
    let objectUrl = null;
    let analysis = null;
    let busy = false;

    const cats = (categories || []).filter(x =>
      !x.kind || x.kind === 'BOTH' || x.kind === 'EXPENSE'
    );

    const root = document.createElement('div');
    root.className = 'se-back';
    root.id = 'smartExpenseModal';
    root.innerHTML = `
      <form class="se-shell" id="seForm">
        <header class="se-head">
          <div class="se-brand">
            <strong>CDS CONTÁBIL CONNECT</strong>
            <span>Nova despesa</span>
          </div>
          <button type="button" class="se-close" id="seClose" aria-label="Fechar">×</button>
        </header>
        <div class="se-body">
          <section class="se-doc">
            <div class="se-doc-label">Documento</div>
            <div class="se-viewer" id="seViewer">
              <div class="se-drop" id="seDrop">
                <strong>Arraste o comprovante</strong>
                <span>PDF, JPG ou PNG</span>
                <button type="button" class="btn secondary" id="sePick">Selecionar arquivo</button>
                <input id="seFile" type="file" accept=".pdf,.jpg,.jpeg,.png" hidden>
              </div>
            </div>
          </section>
          <section class="se-form">
            <div class="se-banner muted" id="seBanner">Anexe um documento para preencher automaticamente.</div>
            ${mode === 'office' && !companyId ? `
              <div class="field">
                <label>Empresa *</label>
                <input name="company_id" id="seCompanyId" required placeholder="ID da empresa" value="">
                <small class="muted">Use a empresa ativa do contexto ou informe o ID.</small>
              </div>` : `
              <input type="hidden" name="company_id" id="seCompanyId" value="${esc(companyId || '')}">
              <div class="field">
                <label>Empresa</label>
                <input value="${esc(companyName || '')}" disabled>
              </div>`}
            <div class="field" data-field="supplier_name">
              <label>Fornecedor ${fieldHint()}</label>
              <input name="supplier_name" id="seSupplier" placeholder="Nome do fornecedor">
            </div>
            <div class="field" data-field="occurred_on">
              <label>Data da competência *</label>
              <input type="date" name="occurred_on" id="seDate" required value="${new Date().toISOString().slice(0, 10)}">
            </div>
            <div class="field" data-field="description">
              <label>Descrição *</label>
              <input name="description" id="seDescription" required placeholder="Ex.: Material de limpeza">
            </div>
            <div class="field" data-field="amount">
              <label>Valor *</label>
              <input name="amount" id="seAmount" required placeholder="R$ 0,00" inputmode="decimal">
            </div>
            <div class="field" data-field="category_id">
              <label>Categoria</label>
              <select name="category_id" id="seCategory">
                <option value="">Outros</option>
                ${cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Forma de pagamento *</label>
              <select name="payment_method" id="sePayment" required>
                ${payOptions.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
              </select>
            </div>
            ${banks && banks.length ? `
              <div class="field">
                <label>Banco / Caixa</label>
                <select name="bank_id" id="seBank">
                  <option value="">Não informado</option>
                  ${banks.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
                </select>
              </div>` : '<input type="hidden" name="bank_id" value="">'}
            <button type="button" class="btn secondary se-reread" id="seReread" disabled>Ler novamente</button>
          </section>
        </div>
        <footer class="se-foot">
          <button type="button" class="btn secondary" id="seCancel">Cancelar</button>
          <button type="submit" class="btn" id="seSave">Salvar despesa</button>
        </footer>
      </form>`;

    document.body.appendChild(root);

    function close() {
      if (objectUrl) try { URL.revokeObjectURL(objectUrl); } catch {}
      root.remove();
      if (onClose) onClose();
    }

    function setBanner(text, kind) {
      const el = root.querySelector('#seBanner');
      el.className = 'se-banner' + (kind ? ' ' + kind : '');
      el.textContent = text;
    }

    function applyFieldHints(fields) {
      root.querySelectorAll('[data-field]').forEach(wrap => {
        const key = wrap.getAttribute('data-field');
        const label = wrap.querySelector('label');
        if (!label) return;
        const base = label.childNodes[0] ? label.childNodes[0].textContent : label.textContent;
        const clean = String(base).replace(/[✓⚠].*$/, '').replace(/\s+$/, '');
        const field = fields && fields[key];
        label.innerHTML = esc(clean) + (field && field.value ? ' ' + fieldHint(field) : '');
        let originEl = wrap.querySelector('.se-origin');
        if (!originEl) {
          originEl = document.createElement('div');
          originEl.className = 'se-origin-wrap';
          wrap.appendChild(originEl);
        }
        originEl.innerHTML = field && field.value ? originHint(field) : '';
        wrap.classList.toggle('needs-review', !!(field && field.needs_review));
        wrap.classList.toggle('auto-filled', !!(field && field.value && field.origin !== 'MANUAL'));
      });
    }

    function applyAnalysis(data) {
      analysis = data;
      const fields = (data && data.fields) || {};
      if (fields.supplier_name && fields.supplier_name.value) {
        root.querySelector('#seSupplier').value = fields.supplier_name.value;
      }
      if (fields.occurred_on && fields.occurred_on.value) {
        root.querySelector('#seDate').value = fields.occurred_on.value;
      }
      if (fields.description && fields.description.value) {
        root.querySelector('#seDescription').value = fields.description.value;
      }
      if (fields.amount && fields.amount.value != null) {
        const amount = Number(fields.amount.value);
        root.querySelector('#seAmount').value = Number.isFinite(amount)
          ? amount.toFixed(2).replace('.', ',')
          : String(fields.amount.value);
      }
      if (fields.category_id && fields.category_id.value) {
        root.querySelector('#seCategory').value = fields.category_id.value;
      }
      if (fields.payment_method && fields.payment_method.value) {
        root.querySelector('#sePayment').value = fields.payment_method.value;
      }
      if (data && data.suggested_bank_id && root.querySelector('#seBank')) {
        root.querySelector('#seBank').value = data.suggested_bank_id;
      }
      applyFieldHints(fields);
      if (data && (data.ai_used || data.visual_ai_used)) {
        setBanner(data.banner || 'Analisado pela IA', 'ai');
      } else if (data && data.status === 'FAILED') {
        setBanner(data.banner || 'Não foi possível interpretar automaticamente este documento. Revise os dados manualmente.', 'warn');
      } else if (data) {
        setBanner(data.banner || 'Preenchido automaticamente', 'ok');
      }
      root.querySelector('#seReread').disabled = !documentId;
    }

    function showPreview(file, meta) {
      const viewer = root.querySelector('#seViewer');
      if (objectUrl) try { URL.revokeObjectURL(objectUrl); } catch {}
      objectUrl = null;
      if (file) {
        objectUrl = URL.createObjectURL(file);
        const isPdf = (file.type || '').includes('pdf') || /\.pdf$/i.test(file.name || '');
        viewer.innerHTML = isPdf
          ? `<iframe class="se-frame" src="${objectUrl}" title="Documento"></iframe>`
          : `<img class="se-image" src="${objectUrl}" alt="Documento">`;
      } else if (meta && meta.id && viewUrlFor) {
        const url = viewUrlFor(meta.id);
        const isPdf = String(meta.mime_type || '').includes('pdf');
        viewer.innerHTML = isPdf
          ? `<iframe class="se-frame" src="${url}" title="Documento"></iframe>`
          : `<img class="se-image" src="${url}" alt="Documento">`;
      }
    }

    async function analyzeDocument(force) {
      if (!documentId) return;
      setBanner(force ? 'Lendo documento novamente...' : 'Analisando documento...', 'busy');
      root.querySelector('#seReread').disabled = true;
      try {
        const url = force ? reanalyzeUrl(documentId) : analyzeUrl(documentId);
        const result = await api(url, { method: 'POST', body: JSON.stringify({ force: !!force }) });
        applyAnalysis(result.analysis || result);
      } catch (error) {
        setBanner('Não foi possível concluir a análise inteligente. Você pode revisar e preencher os dados manualmente.', 'warn');
        if (toast) toast(error.message || 'Falha na análise');
      } finally {
        root.querySelector('#seReread').disabled = !documentId;
      }
    }

    async function ingestFile(file) {
      if (!file || busy) return;
      const ext = String(file.name || '').split('.').pop().toLowerCase();
      if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
        if (toast) toast('Formato não autorizado. Envie JPG, JPEG, PNG ou PDF.');
        return;
      }
      const company = root.querySelector('#seCompanyId').value;
      if (mode === 'office' && !company) {
        if (toast) toast('Informe a empresa antes de anexar o documento.');
        return;
      }
      busy = true;
      setBanner('Enviando documento...', 'busy');
      try {
        const fd = new FormData();
        fd.append('file', file);
        if (mode === 'office') fd.append('company_id', company);
        const uploaded = await api(uploadUrl, { method: 'POST', body: fd });
        documentId = uploaded.id;
        documentMeta = uploaded;
        showPreview(file, uploaded);
        await analyzeDocument(false);
      } catch (error) {
        setBanner('Não foi possível anexar o documento.', 'warn');
        if (toast) toast(error.message || 'Falha no upload');
      } finally {
        busy = false;
      }
    }

    root.querySelector('#seClose').onclick = close;
    root.querySelector('#seCancel').onclick = close;
    root.querySelector('#sePick').onclick = () => root.querySelector('#seFile').click();
    root.querySelector('#seFile').onchange = e => ingestFile(e.target.files && e.target.files[0]);
    const drop = root.querySelector('#seDrop');
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => {
      e.preventDefault();
      drop.classList.remove('over');
      ingestFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    };
    root.querySelector('#seReread').onclick = () => analyzeDocument(true);

    if (mode === 'office' && companyId) {
      root.querySelector('#seCompanyId').value = companyId;
    }

    root.querySelector('#seForm').onsubmit = async e => {
      e.preventDefault();
      if (busy) return;
      const form = new FormData(e.target);
      const description = String(form.get('description') || '').trim();
      const amount = String(form.get('amount') || '').trim();
      const occurredOn = String(form.get('occurred_on') || '').trim();
      const payment = String(form.get('payment_method') || '').trim();
      const company = String(form.get('company_id') || companyId || '').trim();
      if (!company || !description || !amount || !occurredOn || !payment) {
        if (toast) toast('Preencha os campos obrigatórios.');
        return;
      }
      busy = true;
      const btn = root.querySelector('#seSave');
      btn.disabled = true;
      btn.textContent = 'Salvando...';
      try {
        const body = {
          company_id: company,
          occurred_on: occurredOn,
          description,
          amount,
          payment_method: payment,
          category_id: form.get('category_id') || null,
          bank_id: form.get('bank_id') || null,
          supplier_name: form.get('supplier_name') || null,
          document_id: documentId || null
        };
        await api(saveUrl, { method: 'POST', body: JSON.stringify(body) });
        if (toast) toast('Despesa registrada com sucesso. Ela foi enviada para análise da contabilidade.', 'success');
        close();
        if (onSaved) await onSaved();
      } catch (error) {
        if (toast) toast(error.message || 'Não foi possível salvar a despesa.');
        btn.disabled = false;
        btn.textContent = 'Salvar despesa';
      } finally {
        busy = false;
      }
    };

    return { close, applyAnalysis };
  }

  global.CdsSmartExpense = { open };
})(typeof window !== 'undefined' ? window : global);
