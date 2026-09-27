'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
const combo = require('../frontend/public/assets/account-combobox.js');
const appJs = fs.readFileSync(path.join(root, 'frontend/public/assets/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'frontend/public/index.html'), 'utf8');
const comboSrc = fs.readFileSync(path.join(root, 'frontend/public/assets/account-combobox.js'), 'utf8');
const themeCss = fs.readFileSync(path.join(root, 'frontend/public/assets/theme.css'), 'utf8');
const realDbPath = path.join(root, 'database/cds-contabil-connect.db');

process.env.CDS_DB_PATH = path.join(os.tmpdir(), `cds-classif-v2-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-classificacao-movimentacao-v2-secret-ok';
process.env.CDS_COMMS_WORKER = 'off';
process.env.CDS_PROCESS_SCHEDULER = 'off';
try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}

const { app, db } = require('../backend/src/server');

const SAMPLE = [
  { id: 'a5', account_code: '5', classification_code: '1110100001', description: 'CAIXA GERAL', is_postable: 1, active: 1 },
  { id: 'a6', account_code: '6', classification_code: '1110100002', description: 'FUNDO FIXO DE CAIXA', is_postable: 1, active: 1 },
  { id: 'a8', account_code: '8', classification_code: '1110200001', description: 'BANCO DO BRASIL', is_postable: 1, active: 1 },
  { id: 'a9', account_code: '9', classification_code: '1110200002', description: 'CAIXA ECONÔMICA FEDERAL', is_postable: 1, active: 1 },
  { id: 'a11', account_code: '11', classification_code: '1110300001', description: 'POUPANÇA NA CAIXA ECONOMICA FEDERAL', is_postable: 1, active: 1 },
  { id: 'a1027', account_code: '1027', classification_code: '1110200003', description: 'CONTA AZUL', is_postable: 1, active: 1 },
  { id: 'a1028', account_code: '1028', classification_code: '1110200004', description: 'BANCO BRADESCO', is_postable: 1, active: 1 },
  { id: 'syn', account_code: '1', classification_code: '1', description: 'ATIVO', is_postable: 0, active: 1, account_type: 'S' },
  { id: 'off', account_code: '9999', classification_code: '9999999999', description: 'CONTA INATIVA', is_postable: 1, active: 0 }
];

function createMiniDom() {
  let activeElement = null;
  const timeouts = [];

  class ClassList {
    constructor(el) { this.el = el; }
    _parts() { return String(this.el.className || '').split(/\s+/).filter(Boolean); }
    add(...names) {
      const set = new Set(this._parts().concat(names));
      this.el.className = [...set].join(' ');
    }
    remove(...names) {
      const drop = new Set(names);
      this.el.className = this._parts().filter((x) => !drop.has(x)).join(' ');
    }
    contains(name) { return this._parts().includes(name); }
    toggle(name) {
      if (this.contains(name)) this.remove(name);
      else this.add(name);
    }
  }

  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.childNodes = this.children;
      this.parentNode = null;
      this.attributes = {};
      this.className = '';
      this.style = {};
      this.value = '';
      this.hidden = false;
      this.textContent = '';
      this._listeners = {};
      this.classList = new ClassList(this);
      this.ownerDocument = api;
    }
    get firstChild() { return this.children[0] || null; }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      if (key === 'class' || key === 'className') this.className = String(value);
      if (key === 'value') this.value = String(value);
      if (key === 'hidden') this.hidden = true;
    }
    getAttribute(key) {
      if (key === 'class') return this.className || null;
      if (Object.prototype.hasOwnProperty.call(this.attributes, key)) return this.attributes[key];
      return null;
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) {
        this.children.splice(i, 1);
        child.parentNode = null;
      }
      return child;
    }
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    dispatchEvent(event) {
      const list = this._listeners[event.type] || [];
      list.forEach((fn) => fn(event));
      return true;
    }
    focus() { activeElement = this; }
    blur() {
      if (activeElement === this) activeElement = null;
      this.dispatchEvent({ type: 'blur', preventDefault() {}, stopPropagation() {} });
    }
    querySelector(sel) { return queryAll(this, sel)[0] || null; }
    querySelectorAll(sel) { return queryAll(this, sel); }
    scrollIntoView() {}
  }

  function match(el, sel) {
    if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
    if (sel.includes('.')) {
      const [tag, cls] = sel.split('.');
      return el.tagName === tag.toUpperCase() && el.classList.contains(cls);
    }
    return el.tagName === sel.toUpperCase();
  }

  function queryAll(root, sel) {
    const out = [];
    const walk = (node) => {
      node.children.forEach((child) => {
        if (match(child, sel)) out.push(child);
        walk(child);
      });
    };
    walk(root);
    return out;
  }

  const api = {
    createElement(tag) { return new El(tag); },
    createTextNode(text) {
      const n = new El('#text');
      n.textContent = String(text);
      return n;
    }
  };

  Object.defineProperty(api, 'activeElement', {
    get() { return activeElement; },
    set(v) { activeElement = v; }
  });

  return {
    document: api,
    flushTimeouts() {
      const queue = timeouts.splice(0);
      queue.forEach((item) => item.fn());
    },
    installTimers() {
      global.__comboSetTimeout = global.setTimeout;
      global.setTimeout = (fn, ms) => {
        const handle = { fn, ms };
        timeouts.push(handle);
        return handle;
      };
    },
    restoreTimers() {
      if (global.__comboSetTimeout) {
        global.setTimeout = global.__comboSetTimeout;
        delete global.__comboSetTimeout;
      }
      timeouts.length = 0;
    }
  };
}

function codes(list) {
  return list.map((a) => a.account_code);
}

let server;
let base;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  try { db.close(); } catch {}
  try { fs.unlinkSync(process.env.CDS_DB_PATH); } catch {}
});

test('1 pesquisa pelo código exato', () => {
  const hits = combo.filterAccounts(SAMPLE, '1027');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].account_code, '1027');
  assert.equal(hits[0].description, 'CONTA AZUL');
});

test('2 pesquisa por parte do código', () => {
  const hits = combo.filterAccounts(SAMPLE, '102');
  assert.ok(hits.some((a) => a.account_code === '1027'));
  assert.ok(hits.some((a) => a.account_code === '1028'));
});

test('3 pesquisa pelo nome exato', () => {
  const hits = combo.filterAccounts(SAMPLE, 'CONTA AZUL');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].account_code, '1027');
});

test('4 pesquisa por parte do nome', () => {
  const hits = combo.filterAccounts(SAMPLE, 'BANCO');
  assert.deepEqual(codes(hits).sort(), ['1028', '8']);
});

test('5 pesquisa sem diferenciar maiúsculas/minúsculas', () => {
  assert.deepEqual(codes(combo.filterAccounts(SAMPLE, 'caixa')), codes(combo.filterAccounts(SAMPLE, 'CAIXA')));
  assert.deepEqual(codes(combo.filterAccounts(SAMPLE, 'Caixa')), codes(combo.filterAccounts(SAMPLE, 'CAIXA')));
});

test('6 pesquisa sem acentos', () => {
  const hits = combo.filterAccounts(SAMPLE, 'economica');
  assert.ok(hits.some((a) => a.description.includes('ECONÔMICA')));
  assert.ok(hits.some((a) => a.description.includes('ECONOMICA')));
});

test('7 resultado contendo código', () => {
  const label = combo.formatAccountLabel(SAMPLE.find((a) => a.account_code === '1027'));
  assert.match(label, /^1027 \|/);
});

test('8 resultado contendo classificação', () => {
  const label = combo.formatAccountLabel(SAMPLE.find((a) => a.account_code === '1027'));
  assert.match(label, /\| 1110200003 \|/);
});

test('9 resultado contendo descrição', () => {
  const label = combo.formatAccountLabel(SAMPLE.find((a) => a.account_code === '1027'));
  assert.match(label, /\| CONTA AZUL$/);
  assert.equal(label, '1027 | 1110200003 | CONTA AZUL');
});

test('10 seleção pelo teclado', () => {
  const mini = createMiniDom();
  mini.installTimers();
  try {
    const host = mini.document.createElement('div');
    const widget = combo.mount(host, { accounts: SAMPLE, document: mini.document });
    const input = widget.getInput();
    input.focus();
    input.dispatchEvent({ type: 'focus', preventDefault() {}, stopPropagation() {} });
    input.value = 'BANCO';
    input.dispatchEvent({ type: 'input', preventDefault() {}, stopPropagation() {} });
    assert.ok(widget.getVisible().length >= 2);
    input.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {}, stopPropagation() {} });
    input.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {}, stopPropagation() {} });
    assert.ok(widget.getActiveIndex() >= 0);
  } finally {
    mini.restoreTimers();
  }
});

test('11 Enter seleciona', () => {
  const mini = createMiniDom();
  mini.installTimers();
  let selected = null;
  try {
    const host = mini.document.createElement('div');
    const widget = combo.mount(host, {
      accounts: SAMPLE,
      document: mini.document,
      onChange: (id, account) => { selected = account; }
    });
    const input = widget.getInput();
    input.focus();
    input.dispatchEvent({ type: 'focus', preventDefault() {}, stopPropagation() {} });
    input.value = '1027';
    input.dispatchEvent({ type: 'input', preventDefault() {}, stopPropagation() {} });
    input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {}, stopPropagation() {} });
    assert.equal(widget.getValue(), 'a1027');
    assert.equal(selected && selected.account_code, '1027');
    assert.equal(input.value, '1027 | 1110200003 | CONTA AZUL');
    assert.equal(widget.isOpen(), false);
  } finally {
    mini.restoreTimers();
  }
});

test('12 Esc fecha', () => {
  const mini = createMiniDom();
  mini.installTimers();
  try {
    const host = mini.document.createElement('div');
    const widget = combo.mount(host, { accounts: SAMPLE, document: mini.document });
    const input = widget.getInput();
    input.dispatchEvent({ type: 'focus', preventDefault() {}, stopPropagation() {} });
    assert.equal(widget.isOpen(), true);
    let stopped = false;
    input.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault() {},
      stopPropagation() { stopped = true; }
    });
    assert.equal(widget.isOpen(), false);
    assert.equal(stopped, true);
  } finally {
    mini.restoreTimers();
  }
});

test('13 lista vazia quando não houver correspondência', () => {
  const hits = combo.filterAccounts(SAMPLE, 'XYZINEXISTENTE999');
  assert.deepEqual(hits, []);
  const mini = createMiniDom();
  mini.installTimers();
  try {
    const host = mini.document.createElement('div');
    const widget = combo.mount(host, { accounts: SAMPLE, document: mini.document });
    const input = widget.getInput();
    input.dispatchEvent({ type: 'focus', preventDefault() {}, stopPropagation() {} });
    input.value = 'XYZINEXISTENTE999';
    input.dispatchEvent({ type: 'input', preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(widget.getVisible(), []);
    assert.match(widget.getList().querySelector('.account-combo-empty').textContent, /Nenhuma conta encontrada/);
  } finally {
    mini.restoreTimers();
  }
});

test('14 nenhuma alteração nos dados originais', () => {
  const clone = SAMPLE.map((a) => ({ ...a }));
  const before = JSON.stringify(clone);
  combo.filterAccounts(clone, 'caixa');
  combo.formatAccountLabel(clone[0]);
  combo.normalizeSearch('ECONÔMICA');
  assert.equal(JSON.stringify(clone), before);
  assert.doesNotMatch(comboSrc, /UPDATE\s+accounts/i);
  assert.doesNotMatch(comboSrc, /DELETE\s+FROM\s+accounts/i);
  assert.doesNotMatch(appJs, /UPDATE\s+accounts/i);
});

test('15 contas não lançáveis continuam não selecionáveis', () => {
  const hits = combo.filterAccounts(SAMPLE, 'ATIVO');
  assert.ok(!hits.some((a) => a.id === 'syn'));
  const inactive = combo.filterAccounts(SAMPLE, 'INATIVA');
  assert.ok(!inactive.some((a) => a.id === 'off'));
  assert.equal(combo.isPostableAccount(SAMPLE.find((a) => a.id === 'syn')), false);
  assert.equal(combo.selectableAccounts(SAMPLE).some((a) => a.id === 'syn'), false);
});

test('16 plano de 683 contas continua íntegro', () => {
  assert.ok(fs.existsSync(realDbPath), 'database/cds-contabil-connect.db deve existir');
  const real = new Database(realDbPath, { readonly: true });
  try {
    assert.equal(real.prepare('SELECT COUNT(*) n FROM accounts').get().n, 683);
    const azul = real.prepare(
      "SELECT account_code,classification_code,description,is_postable FROM accounts WHERE account_code='1027'"
    ).get();
    assert.deepEqual(azul, {
      account_code: '1027',
      classification_code: '1110200003',
      description: 'CONTA AZUL',
      is_postable: 1
    });
    assert.equal(real.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(real.pragma('foreign_key_check'), []);
  } finally {
    real.close();
  }
});

test('17 nenhum request por tecla', () => {
  assert.doesNotMatch(comboSrc, /\bfetch\s*\(/);
  assert.doesNotMatch(comboSrc, /\bapi\s*\(/);
  assert.doesNotMatch(comboSrc, /\/api\//);
  assert.match(appJs, /CdsAccountCombobox\.mount/);
  assert.match(appJs, /accounts:state\.accounts\|\|\[\]/);
  const mini = createMiniDom();
  mini.installTimers();
  try {
    const host = mini.document.createElement('div');
    const widget = combo.mount(host, { accounts: SAMPLE, document: mini.document });
    const input = widget.getInput();
    input.dispatchEvent({ type: 'focus', preventDefault() {}, stopPropagation() {} });
    input.value = '';
    'BANCO'.split('').forEach((ch) => {
      input.value += ch;
      input.dispatchEvent({ type: 'input', preventDefault() {}, stopPropagation() {} });
    });
    assert.deepEqual(codes(widget.getVisible()).sort(), ['1028', '8']);
  } finally {
    mini.restoreTimers();
  }
});

test('18 foco não é perdido durante a pesquisa', () => {
  const mini = createMiniDom();
  mini.installTimers();
  try {
    const host = mini.document.createElement('div');
    const widget = combo.mount(host, { accounts: SAMPLE, document: mini.document });
    const input = widget.getInput();
    input.focus();
    input.dispatchEvent({ type: 'focus', preventDefault() {}, stopPropagation() {} });
    const sameRef = input;
    input.value = 'CAIXA';
    input.dispatchEvent({ type: 'input', preventDefault() {}, stopPropagation() {} });
    assert.equal(widget.getInput(), sameRef);
    assert.equal(mini.document.activeElement, sameRef);
    assert.ok(widget.getVisible().length >= 3);
  } finally {
    mini.restoreTimers();
  }
});

test('Classificar movimentação usa o combobox (sem barra separada)', () => {
  assert.match(appJs, /account-combo-host/);
  assert.match(appJs, /CdsAccountCombobox\.mount/);
  assert.match(indexHtml, /account-combobox\.js\?v=s40-classif-v2/);
  assert.match(themeCss, /\.account-combo-input/);
  assert.doesNotMatch(appJs, /id="accountSearch"/);
  assert.doesNotMatch(appJs, /Buscar conta contábil/);
  const manual = appJs.slice(appJs.indexOf('function manualEntry'), appJs.indexOf('async function afterClassification'));
  assert.match(manual, /prefill\?`<div class="account-combo-host"/);
});

test('formato Código | Classificação | Descrição nos exemplos do plano', () => {
  const expected = [
    ['5', '1110100001', 'CAIXA GERAL'],
    ['6', '1110100002', 'FUNDO FIXO DE CAIXA'],
    ['8', '1110200001', 'BANCO DO BRASIL'],
    ['1027', '1110200003', 'CONTA AZUL'],
    ['1028', '1110200004', 'BANCO BRADESCO']
  ];
  expected.forEach(([code, classification, description]) => {
    const row = SAMPLE.find((a) => a.account_code === code);
    assert.equal(
      combo.formatAccountLabel(row),
      `${code} | ${classification} | ${description}`
    );
  });
});

test('integrity_check e foreign_key_check do banco de teste', () => {
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('asset account-combobox é servido estaticamente', async () => {
  const r = await fetch(base + '/assets/account-combobox.js?v=s40-classif-v2');
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /formatAccountLabel/);
  assert.match(body, /filterAccounts/);
});
