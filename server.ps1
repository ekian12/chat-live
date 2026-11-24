<#
  Servidor del chat en vivo (PowerShell 5.1+, sin dependencias).
  Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1
  Opcional: -Bind + para escuchar en todas las interfaces (acceso desde la red local).
#>
param(
    [int]$Port = 3000,
    [string]$Bind = 'localhost'
)

$ErrorActionPreference = 'Stop'

$prefix = "http://{0}:{1}/" -f $Bind, $Port
$dataFile = Join-Path $PSScriptRoot 'messages.json'

$script:messages = New-Object 'System.Collections.Generic.List[object]'
$script:users = @{}
$script:known = @{}
$script:nextId = 1

if (Test-Path $dataFile) {
    try {
        $saved = @(Get-Content -Path $dataFile -Raw -Encoding UTF8 | ConvertFrom-Json)
        foreach ($m in $saved) {
            if ($null -eq $m) { continue }
            $script:messages.Add($m)
            if ([int]$m.id -ge $script:nextId) { $script:nextId = [int]$m.id + 1 }
        }
    } catch {
        Write-Host "No se pudo leer messages.json: $_" -ForegroundColor Yellow
    }
}

function Add-Cors($ctx) {
    $h = $ctx.Response.Headers
    $h['Access-Control-Allow-Origin'] = '*'
    $h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    $h['Access-Control-Allow-Headers'] = 'Content-Type'
    $h['Cache-Control'] = 'no-store'
}

function Send-Bytes($ctx, [byte[]]$bytes, [string]$contentType, [int]$status = 200) {
    $ctx.Response.StatusCode = $status
    $ctx.Response.ContentType = $contentType
    Add-Cors $ctx
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
}

function Send-Text($ctx, [string]$text, [string]$contentType, [int]$status = 200) {
    Send-Bytes $ctx ([Text.Encoding]::UTF8.GetBytes($text)) $contentType $status
}

function Send-Json($ctx, $obj, [int]$status = 200) {
    $json = ConvertTo-Json -InputObject $obj -Depth 8 -Compress
    Send-Text $ctx $json 'application/json; charset=utf-8' $status
}

function Read-Json($ctx) {
    $reader = New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
    $raw = $reader.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
    try { return ($raw | ConvertFrom-Json) } catch { return @{} }
}

function Save-Messages {
    $arr = @($script:messages.ToArray())
    $json = ConvertTo-Json -InputObject $arr -Depth 8 -Compress
    [IO.File]::WriteAllText($dataFile, $json, (New-Object Text.UTF8Encoding($false)))
}

function Add-Message([string]$kind, [string]$user, [string]$text) {
    $message = [ordered]@{
        id   = $script:nextId
        kind = $kind
        user = $user
        text = $text
        time = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    $script:nextId++
    $script:messages.Add($message)
    if ($script:messages.Count -gt 300) {
        $script:messages.RemoveRange(0, $script:messages.Count - 300)
    }
    Save-Messages
    return $message
}

function Add-SystemMessage([string]$text) {
    Add-Message 'system' '' $text | Out-Null
}

function Prune-Users {
    $now = [DateTime]::UtcNow
    $stale = @($script:users.Keys | Where-Object {
        ($now - $script:users[$_].lastSeen).TotalSeconds -gt 20
    })
    foreach ($name in $stale) {
        $script:users.Remove($name) | Out-Null
        $script:known.Remove($name) | Out-Null
        Add-SystemMessage "$name salió del chat"
    }
}

function Clean-Name([string]$value) {
    if ($null -eq $value) { return '' }
    $v = $value.Trim() -replace '\s+', ' '
    if ($v.Length -gt 24) { $v = $v.Substring(0, 24) }
    return $v
}

function Clean-Text([string]$value) {
    if ($null -eq $value) { return '' }
    $v = $value.Trim()
    if ($v.Length -gt 500) { $v = $v.Substring(0, 500) }
    return $v
}

function Get-ContentType([string]$file) {
    if ($file -match '\.css$') { return 'text/css; charset=utf-8' }
    if ($file -match '\.js$') { return 'application/javascript; charset=utf-8' }
    return 'text/html; charset=utf-8'
}

function Handle-Request($ctx) {
    $path = $ctx.Request.Url.AbsolutePath.TrimEnd('/')
    if ($path -eq '') { $path = '/' }

    if ($ctx.Request.HttpMethod -eq 'OPTIONS') {
        $ctx.Response.StatusCode = 204
        Add-Cors $ctx
        $ctx.Response.Close()
        return
    }

    if ($ctx.Request.HttpMethod -eq 'GET') {
        switch ($path) {
            '/' { $path = '/index.html' }
        }

        if ($path -eq '/api/state') {
            Prune-Users

            $q = $ctx.Request.QueryString
            $after = 0
            if ($q['after'] -match '^\d+$') { $after = [int]$q['after'] }
            $name = Clean-Name $q['user']
            $typing = ($q['typing'] -eq '1')

            if ($name) {
                if (-not $script:known.ContainsKey($name)) {
                    Add-SystemMessage "$name se unió al chat"
                }
                $script:known[$name] = $true
                $script:users[$name] = @{
                    name     = $name
                    lastSeen = [DateTime]::UtcNow
                    typing   = $typing
                }
            }

            $visible = @($script:messages | Where-Object { [int]$_.id -gt $after } | Select-Object -First 100)
            $online = @($script:users.Keys | ForEach-Object {
                [ordered]@{ name = $_; typing = [bool]$script:users[$_].typing }
            } | Sort-Object { $_.name })

            Send-Json $ctx ([ordered]@{
                now      = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                messages = $visible
                users    = $online
                count    = $online.Count
            })
            return
        }

        if ($path -in @('/index.html', '/styles.css', '/app.js')) {
            $file = Join-Path $PSScriptRoot ($path.TrimStart('/'))
            if (-not (Test-Path $file)) {
                Send-Text $ctx 'Archivo no encontrado' 'text/plain; charset=utf-8' 404
                return
            }
            Send-Bytes $ctx ([IO.File]::ReadAllBytes($file)) (Get-ContentType $path)
            return
        }

        if ($path -eq '/favicon.ico') {
            $ctx.Response.StatusCode = 204
            Add-Cors $ctx
            $ctx.Response.Close()
            return
        }

        Send-Text $ctx 'No encontrado' 'text/plain; charset=utf-8' 404
        return
    }

    if ($ctx.Request.HttpMethod -eq 'POST') {
        $body = Read-Json $ctx

        if ($path -eq '/api/messages') {
            $name = Clean-Name $body.user
            $text = Clean-Text $body.text
            if (-not $name -or -not $text) {
                Send-Json $ctx @{ error = 'Nombre y mensaje son obligatorios' } 400
                return
            }
            $message = Add-Message 'user' $name $text
            Send-Json $ctx $message 201
            return
        }

        if ($path -eq '/api/leave') {
            $name = Clean-Name $body.user
            if ($name) {
                $script:users.Remove($name) | Out-Null
                $script:known.Remove($name) | Out-Null
                Add-SystemMessage "$name salió del chat"
            }
            Send-Json $ctx @{ ok = $true }
            return
        }

        Send-Json $ctx @{ error = 'Ruta no encontrada' } 404
        return
    }

    Send-Text $ctx 'Método no permitido' 'text/plain; charset=utf-8' 405
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
} catch {
    Write-Host "No se pudo iniciar el servidor en $prefix" -ForegroundColor Red
    Write-Host $_ -ForegroundColor Red
    Write-Host "Prueba con otro puerto: -Port 3001 o con -Bind + (requiere permisos)." -ForegroundColor Yellow
    exit 1
}

Write-Host "======================================" -ForegroundColor Cyan
Write-Host " Chat en vivo iniciado" -ForegroundColor Green
Write-Host " Abre: $prefix" -ForegroundColor Green
if ($Bind -eq 'localhost') {
    Write-Host " Para entrar desde otros equipos: -Bind +" -ForegroundColor Yellow
}
Write-Host " Ctrl+C para detener" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
    } catch {
        break
    }
    try {
        Handle-Request $ctx
    } catch {
        Write-Host "Error al atender petición: $_" -ForegroundColor Red
        try { $ctx.Response.Close() } catch { }
    }
}

$listener.Stop()
$listener.Close()
