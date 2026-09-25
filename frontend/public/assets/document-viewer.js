(function (global) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const VIEWABLE = { 'application/pdf': 'pdf', 'image/jpeg': 'image', 'image/jpg': 'image', 'image/pjpeg': 'image', 'image/png': 'image' };
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3;
  const ZOOM_STEP = 0.25;

  let zoom = 1;
  let zoomKind = 'other';
  let zoomWheelBound = null;

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

  function clampZoom(v) {
    const n = Math.round(Number(v) / ZOOM_STEP) * ZOOM_STEP;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(n.toFixed(2))));
  }

  function applyZoom() {
    const el = document.getElementById('docViewer');
    if (!el) return;
    const target = el.querySelector('.doc-viewer-zoom-target');
    const label = el.querySelector('#docViewerZoomLabel');
    const outBtn = el.querySelector('#docViewerZoomOut');
    const inBtn = el.querySelector('#docViewerZoomIn');
    if (target) {
      target.style.transform = 'scale(' + zoom + ')';
      target.style.transformOrigin = zoomKind === 'pdf' ? 'top center' : 'center center';
    }
    if (label) label.textContent = Math.round(zoom * 100) + '%';
    if (outBtn) outBtn.disabled = zoom <= ZOOM_MIN;
    if (inBtn) inBtn.disabled = zoom >= ZOOM_MAX;
  }

  function setZoom(next) {
    zoom = clampZoom(next);
    applyZoom();
  }

  function showZoomControls(show) {
    const tools = document.getElementById('docViewerZoom');
    if (tools) tools.hidden = !show;
  }

  function bindZoomControls() {
    const root = document.getElementById('docViewer');
    if (!root) return;
    const outBtn = root.querySelector('#docViewerZoomOut');
    const inBtn = root.querySelector('#docViewerZoomIn');
    const resetBtn = root.querySelector('#docViewerZoomReset');
    if (outBtn) outBtn.onclick = () => setZoom(zoom - ZOOM_STEP);
    if (inBtn) inBtn.onclick = () => setZoom(zoom + ZOOM_STEP);
    if (resetBtn) resetBtn.onclick = () => setZoom(1);

    if (zoomWheelBound) {
      root.removeEventListener('wheel', zoomWheelBound, { passive: false });
    }
    zoomWheelBound = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom(zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    };
    root.addEventListener('wheel', zoomWheelBound, { passive: false });
  }

  function closeViewer() {
    const el = document.getElementById('docViewer');
    if (!el) return;
    if (zoomWheelBound) {
      try { el.removeEventListener('wheel', zoomWheelBound, { passive: false }); } catch {}
      zoomWheelBound = null;
    }
    const url = el.dataset.objectUrl;
    if (url) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    document.removeEventListener('keydown', onEsc, true);
    zoom = 1;
    zoomKind = 'other';
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

  function renderBody(kind, objectUrl) {
    if (kind === 'pdf') {
      return `<div class="doc-viewer-zoom-wrap"><div class="doc-viewer-zoom-target doc-viewer-zoom-target--pdf"><object class="doc-viewer-frame" type="application/pdf" data="${esc(objectUrl)}"><iframe class="doc-viewer-frame" title="Visualização do PDF" src="${esc(objectUrl)}"></iframe></object></div></div><p class="doc-viewer-fallback" hidden>Não foi possível visualizar este documento neste navegador.</p>`;
    }
    if (kind === 'image') {
      return `<div class="doc-viewer-zoom-wrap"><div class="doc-viewer-zoom-target doc-viewer-zoom-target--image"><img class="doc-viewer-image" alt="${esc('Documento')}" src="${esc(objectUrl)}"></div></div>`;
    }
    return `<div class="doc-viewer-msg"><p>Este tipo de documento não possui visualização interna.</p></div>`;
  }

  function open(opts) {
    closeViewer();
    const fileName = opts.fileName || 'Documento';
    const mimeType = opts.mimeType || '';
    const kind = kindOf(fileName, mimeType);
    const meta = [typeLabel(fileName, mimeType), sizeLabel(opts.sizeBytes)].filter(Boolean).join(' · ');
    document.body.insertAdjacentHTML('beforeend', `<div class="doc-viewer-back" id="docViewer" role="dialog" aria-modal="true" aria-labelledby="docViewerTitle"><div class="doc-viewer"><header class="doc-viewer-head"><div><h2 id="docViewerTitle">${esc(fileName)}</h2><p class="doc-viewer-type">${esc(meta || typeLabel(fileName, mimeType))}</p></div><button type="button" class="btn secondary" id="docViewerClose" aria-label="Fechar">×</button></header><div class="doc-viewer-body" id="docViewerBody"><p class="doc-viewer-msg">Carregando documento...</p></div><footer class="doc-viewer-foot"><span class="doc-viewer-info" id="docViewerInfo">${esc(meta)}</span><div class="doc-viewer-zoom" id="docViewerZoom" hidden><button type="button" class="btn secondary" id="docViewerZoomOut" aria-label="Diminuir zoom">−</button><button type="button" class="btn secondary" id="docViewerZoomReset" aria-label="Zoom 100%">100%</button><span class="doc-viewer-zoom-label" id="docViewerZoomLabel" aria-live="polite">100%</span><button type="button" class="btn secondary" id="docViewerZoomIn" aria-label="Aumentar zoom">+</button></div><button type="button" class="btn" id="docViewerDownload" aria-label="Baixar documento">Baixar documento</button></footer></div></div>`);
    const root = document.getElementById('docViewer');
    const body = document.getElementById('docViewerBody');
    const closeBtn = document.getElementById('docViewerClose');
    const dlBtn = document.getElementById('docViewerDownload');
    const resetBtn = document.getElementById('docViewerZoomReset');
    closeBtn.onclick = closeViewer;
    dlBtn.onclick = async () => {
      try { await triggerDownload(opts); } catch (err) { body.innerHTML = `<div class="doc-viewer-msg"><p>Não foi possível carregar o documento.</p></div>`; }
    };
    document.addEventListener('keydown', onEsc, true);
    bindZoomControls();
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
        zoomKind = shownKind;
        zoom = 1;
        body.innerHTML = renderBody(shownKind, objectUrl);
        showZoomControls(true);
        if (resetBtn) resetBtn.textContent = 'Ajustar';
        applyZoom();
        const frame = body.querySelector('object, iframe, img');
        if (frame) {
          frame.addEventListener('error', () => {
            const fb = body.querySelector('.doc-viewer-fallback');
            if (fb) fb.hidden = false;
            else body.innerHTML = `<div class="doc-viewer-msg"><p>Não foi possível visualizar este documento neste navegador.</p></div>`;
            showZoomControls(false);
          });
        }
      } catch {
        body.innerHTML = `<div class="doc-viewer-msg"><p>Não foi possível carregar o documento.</p></div>`;
        showZoomControls(false);
      }
    })();
  }

  global.CdsDocumentViewer = { open, close: closeViewer, kindOf, typeLabel };
})(typeof window !== 'undefined' ? window : globalThis);
