'use strict';

const os = require('os');
const path = require('path');

function resolveNetworkMode(env = process.env) {
  const raw = String(env.CDS_NETWORK_MODE || 'local').trim().toLowerCase();
  if (!raw || raw === 'local') return 'local';
  if (raw === 'lan') return 'lan';
  throw new Error('CDS_NETWORK_MODE must be "local" or "lan".');
}

function isPrivateIPv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function listPrivateIPv4(networkInterfaces = os.networkInterfaces()) {
  const out = [];
  for (const addrs of Object.values(networkInterfaces || {})) {
    for (const a of addrs || []) {
      const family = a.family;
      if (family !== 'IPv4' && family !== 4) continue;
      if (a.internal) continue;
      const addr = String(a.address || '');
      if (addr === '127.0.0.1') continue;
      if (!isPrivateIPv4(addr)) continue;
      if (!out.includes(addr)) out.push(addr);
    }
  }
  return out;
}

function isProductionDatabasePath(dbPath, root) {
  const resolved = path.resolve(String(dbPath || ''));
  const prodDefault = path.resolve(root, 'database', 'production', 'cds-contabil-connect.db');
  if (resolved === prodDefault) return true;
  const norm = resolved.replace(/\\/g, '/').toLowerCase();
  return /\/database\/production\//.test(norm) || /\/database\/production$/i.test(path.dirname(resolved).replace(/\\/g, '/'));
}

function assertLanAllowed({ networkMode, isProd, dbPath, root }) {
  if (networkMode !== 'lan') return;
  if (isProd) {
    throw new Error('LAN MODE IS NOT ALLOWED IN PRODUCTION');
  }
  if (isProductionDatabasePath(dbPath, root)) {
    throw new Error('LAN MODE CANNOT USE PRODUCTION DATABASE');
  }
}

function listenHost(networkMode) {
  return networkMode === 'lan' ? '0.0.0.0' : undefined;
}

function formatLanBanner({ port, clientPort, ips }) {
  const lines = [
    '========================================',
    ' CDS CONTÁBIL CONNECT — TESTE LAN',
    '========================================',
    ' MODO: LAN / TESTE',
    ' BANCO: PILOTO/LOCAL',
    '',
    ' Acesso neste computador:',
    ` http://localhost:${port}`,
    ''
  ];
  const list = Array.isArray(ips) && ips.length ? ips : [];
  if (list.length) {
    lines.push(' Acesso pela rede:');
    for (const ip of list) {
      lines.push(` http://${ip}:${port}`);
    }
  } else {
    lines.push(' Acesso pela rede:');
    lines.push(' (nenhum IPv4 privado detectado — verifique a placa de rede)');
  }
  if (clientPort > 0 && clientPort !== port) {
    lines.push('');
    lines.push(` Portal (CLIENT_PORT=${clientPort}):`);
    lines.push(` http://localhost:${clientPort}`);
    for (const ip of list) {
      lines.push(` http://${ip}:${clientPort}`);
    }
  } else {
    lines.push('');
    lines.push(` Portal do cliente: http://localhost:${port}/portal/`);
  }
  lines.push('');
  lines.push('========================================');
  return lines.join('\n');
}

module.exports = {
  resolveNetworkMode,
  isPrivateIPv4,
  listPrivateIPv4,
  isProductionDatabasePath,
  assertLanAllowed,
  listenHost,
  formatLanBanner
};
