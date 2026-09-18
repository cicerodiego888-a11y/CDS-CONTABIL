(function (global) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const VIEWABLE = { 'application/pdf': 'pdf', 'image/jpeg': 'image', 'image/jpg': 'image', 'image/pjpeg': 'image', 'image/png': 'image' };

  function kindOf(fileName, mimeType) {
    const mime = String(mimeType || '').toLowerCase();
    if (VIEWABLE[mime]) return VIEWABLE[mime];
    const ext = String(fileName || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return 'image';
    return 'other';
  }

  function typeLabel(fileName, mimeType) {
    const kind = kindOf(fileName, mimeType);
    if (kind === 'pdf') return 'PDF';
    if (kind === 'image') {
      const ext = String(fileName || '').split('.').pop().toUpperCase();
      if (ext === 'PNG') return 'PNG';
      if (ext === 'JPG' || ext === 'JPEG') return ext;
      if (String(mimeType || '').includes('png')) return 'PNG';
      return 'JPEG';
    }
    return (String(fileName || '').split('.').pop() || 'arquivo').toUpperCase();
  }

  function sizeLabel(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '';
    if (n < 1024) return n + ' B';
    return Math.round(n / 1024) + ' KB';
  }

  function closeViewer() {
    const el = document.getElementById('docViewer');
    if (!el) return;
    const url = el.dataset.objectUrl;
    if (url) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    document.removeEventListener('keydown', onEsc, true);
    el.remove();
  }

  function onEsc(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeViewer();
    }
  }

  async function triggerDownload(opts) {
    const headers = typeof opts.headers === 'function' ? opts.headers() : (opts.headers || {});
    const r = await fetch(opts.downloadUrl, { headers, cache: 'no-store' });
    if (!r.ok) throw new Error('Não foi possível baixar o documento.');
    const blob = await r.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = opts.fileName || 'documento';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1500);
  }

  function renderBody(kind, objectUrl, mimeType) {
    if (kind === 'pdf') {
      return `<object class="doc-viewer-frame" type="application/pdf" data="${esc(objectUrl)}"><iframe class="doc-viewer-frame" title="Visualização do PDF" src="${esc(objectUrl)}"></iframe></object><p class="doc-viewer-fallback" hidden>Não foi possível visualizar este documento neste navegador.</p>`;
    }
    if (kind === 'image') {
      return `<img class="doc-viewer-image" alt="${esc('Documento')}" src="${esc(objectUrl)}">`;
    }
    return `<div class="doc-viewer-msg"><p>Este tipo de documento não possui visualização interna.</p></div>`;
  }

  function open(opts) {
    closeViewer();
    const fileName = opts.fileName || 'Documento';
    const mimeType = opts.mimeType || '';
    const kind = kindOf(fileName, mimeType);
    const meta = [typeLabel(fileName, mimeType), sizeLabel(opts.sizeBytes)].filter(Boolean).join(' · ');
    document.body.insertAdjacentHTML('beforeend', `<div class="doc-viewer-back" id="docViewer" role="dialog" aria-modal="true" aria-labelledby="docViewerTitle"><div class="doc-viewer"><header class="doc-viewer-head"><div><h2 id="docViewerTitle">${esc(fileName)}</h2><p class="doc-viewer-type">${esc(meta || typeLabel(fileName, mimeType))}</p></div><button type="button" class="btn secondary" id="docViewerClose" aria-label="Fechar">×</button></header><div class="doc-viewer-body" id="docViewerBody"><p class="doc-viewer-msg">Carregando documento...</p></div><footer class="doc-viewer-foot"><span class="doc-viewer-info" id="docViewerInfo">${esc(meta)}</span><button type="button" class="btn" id="docViewerDownload" aria-label="Baixar documento">Baixar documento</button></footer></div></div>`);
    const root = document.getElementById('docViewer');
    const body = document.getElementById('docViewerBody');
    const closeBtn = document.getElementById('docViewerClose');
    const dlBtn = document.getElementById('docViewerDownload');
    closeBtn.onclick = closeViewer;
    dlBtn.onclick = async () => {
      try { await triggerDownload(opts); } catch (err) { body.innerHTML = `<div class="doc-viewer-msg"><p>Não foi possível carregar o documento.</p></div>`; }
    };
    document.addEventListener('keydown', onEsc, true);
    closeBtn.focus();

    if (kind === 'other') {
      body.innerHTML = `<div class="doc-viewer-msg"><p>Este tipo de documento não possui visualização interna.</p></div>`;
      return;
    }

    (async () => {
      try {
        const headers = typeof opts.headers === 'function' ? opts.headers() : (opts.headers || {});
        const r = await fetch(opts.viewUrl, { headers, cache: 'no-store' });
        if (r.status === 404) {
          body.innerHTML = `<div class="doc-viewer-msg"><p>Documento não encontrado.</p></div>`;
          return;
        }
        if (!r.ok) {
          body.innerHTML = `<div class="doc-viewer-msg"><p>Não foi possível carregar o documento.</p></div>`;
          return;
        }
        const blob = await r.blob();
        const type = r.headers.get('Content-Type') || blob.type || mimeType;
        const shownKind = kindOf(fileName, type);
        if (shownKind === 'other') {
          body.innerHTML = `<div class="doc-viewer-msg"><p>Este tipo de documento não possui visualização interna.</p></div>`;
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        root.dataset.objectUrl = objectUrl;
        body.innerHTML = renderBody(shownKind, objectUrl, type);
        const frame = body.querySelector('object, iframe, img');
        if (frame) {
          frame.addEventListener('error', () => {
            const fb = body.querySelector('.doc-viewer-fallback');
            if (fb) fb.hidden = false;
            else body.innerHTML = `<div class="doc-viewer-msg"><p>Não foi possível visualizar este documento neste navegador.</p></div>`;
          });
        }
      } catch {
        body.innerHTML = `<div class="doc-viewer-msg"><p>Não foi possível carregar o documento.</p></div>`;
      }
    })();
  }

  global.CdsDocumentViewer = { open, close: closeViewer, kindOf, typeLabel };
})(typeof window !== 'undefined' ? window : globalThis);
