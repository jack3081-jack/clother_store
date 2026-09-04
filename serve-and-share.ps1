# serve-and-share.ps1
# Usage: run from the project folder where index.html is present

$port = 8000

# check python
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
    Write-Error "Python not found. Install Python or use Live Server in VS Code."
    exit 1
}

# check ngrok
$ngrok = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrok) {
    Write-Error "ngrok not found. Install ngrok and ensure it's in PATH."
    exit 1
}

# Start python server in hidden window
Write-Host "Starting local server on port $port..."
Start-Process -FilePath $py.Path -ArgumentList "-m http.server $port --bind 0.0.0.0" -WindowStyle Hidden
Start-Sleep -Seconds 1

# Verify local server started
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:$port" -UseBasicParsing -TimeoutSec 3
    Write-Host "Local server is running (HTTP 200 OK)."
} catch {
    Write-Host "Warning: local server didn't respond yet. Check if port $port is in use. Continuing to start ngrok..."
}

# Start ngrok in a new window so you can see logs
Write-Host "Starting ngrok forwarding to port $port (a new window will open)..."
Start-Process -FilePath $ngrok.Path -ArgumentList "http $port"

# Allow ngrok a couple seconds to initialize then poll its local API
$forward = $null
for ($i = 0; $i -lt 15 -and -not $forward; $i++) {
    Start-Sleep -Seconds 1
    try {
        $t = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -ErrorAction Stop
        if ($t.tunnels -and $t.tunnels.Count -gt 0) {
            $forward = ($t.tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1).public_url
            if (-not $forward) { $forward = $t.tunnels[0].public_url }
        }
    } catch {}
}

if ($forward) {
    Write-Host ""
    Write-Host "Your site is available to open on other devices at:" -ForegroundColor Green
    Write-Host $forward -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Open the URL above on your phone's browser (use https version if available)."
    Write-Host "If it doesn't load on your phone, paste the URL here and I'll help debug."
} else {
    Write-Host ""
    Write-Error "Couldn't read ngrok's tunnel info. Open the ngrok window (it should have opened) and copy the 'Forwarding' https URL, or show me the output."
}