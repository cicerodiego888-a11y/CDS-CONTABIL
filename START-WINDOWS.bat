@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install || goto :error
)
call npm run setup || goto :error
if not exist database\cds-contabil-connect.db call npm run seed || goto :error
start "CDS Contabil Connect" cmd /k "npm start"
timeout /t 2 >nul
start "" http://localhost:3333
exit /b 0
:error
echo.
echo Falha na instalacao/inicializacao.
pause
exit /b 1
