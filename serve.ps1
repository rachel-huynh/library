# Minimal static file server for local development.
# ES modules need real HTTP - opening courses.html as a file:// URL will not work.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1
#
# Then open http://localhost:8123/ (which serves courses.html).

param(
  [string]$Root = $PSScriptRoot,
  [int]$Port = 8123
)

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "." }
$Root = (Resolve-Path $Root).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Serving $Root on http://localhost:$Port/"

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".sql"  = "text/plain; charset=utf-8"
  ".md"   = "text/plain; charset=utf-8"
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "courses.html" }
    $path = Join-Path $Root $rel

    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      $ctype = $types[$ext]
      if (-not $ctype) { $ctype = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $ctx.Response.ContentType = $ctype
      $ctx.Response.StatusCode = 200
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Output "200 $rel"
    } else {
      $ctx.Response.StatusCode = 404
      Write-Output "404 $rel"
    }
    $ctx.Response.OutputStream.Close()
  } catch {
    Write-Output ("ERR " + $_.Exception.Message)
  }
}
