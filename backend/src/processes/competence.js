'use strict';

const MONTHS_PT = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function parseCompetence(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  let year, month;
  if (s.includes('-')) {
    year = Number(m[1]);
    month = Number(m[2]);
  } else {
    month = Number(m[1]);
    year = Number(m[2]);
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const competence = `${year}-${String(month).padStart(2, '0')}`;
  return { competence, year, month, label: `${MONTHS_PT[month]}/${year}` };
}

function occurrenceTitle(processName, competenceInfo) {
  return `${String(processName || 'Processo').trim()} — ${competenceInfo.label}`;
}

module.exports = { parseCompetence, occurrenceTitle, MONTHS_PT };
