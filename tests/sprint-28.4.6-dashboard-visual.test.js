'use strict';

const path = require('path');
const fs = require('fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const js = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/app.js'), 'utf8');
const theme = fs.readFileSync(path.join(__dirname, '../frontend/public/assets/theme.css'), 'utf8');

test('dashboard 28.4.6 restaura composição aprovada sem componentes proibidos', () => {
  assert.match(js, /greetUser\(\)/);
  assert.match(js, /Bom dia/);
  assert.match(js, /Boa tarde/);
  assert.match(js, /Boa noite/);
  assert.match(js, /dash-head-sub/);
  assert.match(js, /dash-crumb/);
  assert.match(js, /ops-kpi-ico/);
  assert.match(js, /Resumo Contábil do Período/);
  assert.match(js, /Visão consolidada da movimentação contábil/);
  assert.match(js, /opsChartSvg/);
  assert.match(js, /ops-tip/);
  assert.match(js, /Saúde Contábil do Escritório/);
  assert.match(js, /opsHealthHtml/);
  assert.match(js, /Próximos Prazos/);
  assert.match(js, /Últimas Atividades/);
  assert.match(js, /Sistema online/);
  assert.match(js, /officeClockHtml/);
  assert.match(js, /side-office-card/);
  assert.match(theme, /\.ops-summary-tiles/);
  assert.match(theme, /\.ops-donut/);
  assert.doesNotMatch(theme, /#0f5f59/i);
  assert.doesNotMatch(js, /Documentos por Tipo/);
  assert.doesNotMatch(js, /Situação Fiscal/);
  assert.doesNotMatch(js, /ops-monthly/);
  assert.doesNotMatch(js, /Mais que um sistema/);
  const dashFn = js.slice(js.indexOf('async function dashboard'), js.indexOf('async function crudCompanies'));
  assert.doesNotMatch(dashFn, /officeIdentityHtml\(\)/);
  assert.doesNotMatch(dashFn, /d\.monthly/);
  assert.doesNotMatch(dashFn, /dash-hero/);
  assert.doesNotMatch(dashFn, /Olá,/);
});
