# Teste LAN (somente desenvolvimento local)

Permite que outro computador na **mesma rede local** acesse o CDS Contábil Connect rodando na máquina do escritório/contador.

## Quando usar

Somente para demonstração/teste interno. **Não** use em produção.

## Como ativar

No `.env` local (não o de produção):

```env
CDS_NETWORK_MODE=lan
```

Padrão (sem alterar nada):

```env
CDS_NETWORK_MODE=local
```

Reinicie o servidor:

```bash
npm start
```

O console exibirá o banner com `http://localhost:PORT` e `http://IP_DA_REDE:PORT`.

## Banco

O modo LAN usa o banco **piloto/local** já configurado em `CDS_DB_PATH` (padrão `database/cds-contabil-connect.db`).

Não aponta para `database/production/`.

## Proteções

| Situação | Resultado |
|---|---|
| `NODE_ENV=production` + `CDS_NETWORK_MODE=lan` | Erro: `LAN MODE IS NOT ALLOWED IN PRODUCTION` |
| LAN + `CDS_DB_PATH` em `database/production/` | Erro: `LAN MODE CANNOT USE PRODUCTION DATABASE` |

## Firewall do Windows

Esta sprint **não** altera o Firewall automaticamente.

Na primeira execução em modo LAN, o Windows pode pedir autorização de rede para o Node.js:

- Prefira **rede privada** / confiável.
- Autorize o Node.js apenas se estiver em rede do escritório de confiança.
- Não use LAN em redes públicas (café, hotel, etc.).

Se o outro computador não abrir a URL, verifique:

1. Mesma rede Wi‑Fi/cabeada
2. Firewall liberou a porta (`PORT`, tipicamente 3333; e `CLIENT_PORT` se dual-port)
3. IP exibido no banner corresponde à interface ativa

## CORS

Não abra CORS com `*`. O acesso LAN usa a mesma origem da URL digitada no navegador.
