Set-Location $PSScriptRoot
if (-not (Test-Path node_modules)) { npm install; if ($LASTEXITCODE -ne 0) { throw 'npm install falhou' } }
npm run setup
if (-not (Test-Path 'database/cds-contabil-connect.db')) { npm run seed }
Start-Process powershell -ArgumentList '-NoExit','-Command','npm start'
Start-Sleep -Seconds 2
Start-Process 'http://localhost:3333'
