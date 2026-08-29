$ErrorActionPreference = "Stop"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Test-SteamCommunityUri([System.Uri]$Uri) {
  return $null -ne $Uri `
    -and $Uri.IsAbsoluteUri `
    -and $Uri.Scheme -ceq "https" `
    -and $Uri.Host -ieq "steamcommunity.com" `
    -and $Uri.Port -eq 443 `
    -and [string]::IsNullOrEmpty($Uri.UserInfo)
}

function Write-BridgeResult($Value) {
  [Console]::Out.Write(($Value | ConvertTo-Json -Compress -Depth 4))
}

$handler = $null
$client = $null
$response = $null
$stream = $null
$memory = $null
$errorCode = "STEAM_WINDOWS_NETWORK"

try {
  $rawPayload = [Console]::In.ReadToEnd()
  $payload = $rawPayload | ConvertFrom-Json
  $currentUri = New-Object System.Uri([string]$payload.url)
  if (-not (Test-SteamCommunityUri $currentUri)) {
    $errorCode = "STEAM_URL_REJECTED"
    throw "Güvenli olmayan Steam adresi reddedildi."
  }

  $timeoutMs = [Math]::Max(1000, [Math]::Min(120000, [int]$payload.timeoutMs))
  $maxBytes = [Math]::Max(1024, [Math]::Min(16777216, [int]$payload.maxBytes))
  $maxRedirects = [Math]::Max(0, [Math]::Min(5, [int]$payload.maxRedirects))

  Add-Type -AssemblyName System.Net.Http
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $false
  $handler.UseCookies = $false
  $handler.UseProxy = $true
  $handler.Proxy = [System.Net.WebRequest]::DefaultWebProxy
  if ($null -ne $handler.Proxy) {
    $handler.Proxy.Credentials = [System.Net.CredentialCache]::DefaultCredentials
  }

  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromMilliseconds($timeoutMs)

  for ($redirectCount = 0; $redirectCount -le $maxRedirects; $redirectCount += 1) {
    $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $currentUri)
    try {
      foreach ($property in $payload.headers.PSObject.Properties) {
        [void]$request.Headers.TryAddWithoutValidation([string]$property.Name, [string]$property.Value)
      }
      $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    } finally {
      $request.Dispose()
    }

    $status = [int]$response.StatusCode
    $location = $response.Headers.Location
    if ($status -ge 300 -and $status -lt 400 -and $null -ne $location) {
      if ($redirectCount -ge $maxRedirects) {
        $errorCode = "STEAM_REDIRECT_LIMIT"
        throw "Steam Community çok fazla yönlendirme yaptı."
      }
      $nextUri = if ($location.IsAbsoluteUri) { $location } else { New-Object System.Uri($currentUri, $location) }
      if (-not (Test-SteamCommunityUri $nextUri)) {
        $errorCode = "STEAM_URL_REJECTED"
        throw "Steam dışı yönlendirme reddedildi."
      }
      $currentUri = $nextUri
      $response.Dispose()
      $response = $null
      continue
    }

    $contentLength = $response.Content.Headers.ContentLength
    if ($null -ne $contentLength -and $contentLength -gt $maxBytes) {
      $errorCode = "STEAM_RESPONSE_TOO_LARGE"
      throw "Steam Community yanıtı güvenli boyut sınırını aştı."
    }

    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $memory = New-Object System.IO.MemoryStream
    $buffer = New-Object byte[] 8192
    $received = 0
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $received += $read
      if ($received -gt $maxBytes) {
        $errorCode = "STEAM_RESPONSE_TOO_LARGE"
        throw "Steam Community yanıtı güvenli boyut sınırını aştı."
      }
      $memory.Write($buffer, 0, $read)
    }

    $encoding = New-Object System.Text.UTF8Encoding($false)
    $charset = $response.Content.Headers.ContentType.CharSet
    if (-not [string]::IsNullOrWhiteSpace($charset)) {
      try { $encoding = [System.Text.Encoding]::GetEncoding($charset.Trim('"')) } catch { }
    }
    $text = $encoding.GetString($memory.ToArray())
    Write-BridgeResult @{
      ok = $true
      status = $status
      text = $text
      finalUrl = $currentUri.AbsoluteUri
    }
    exit 0
  }
} catch [System.Threading.Tasks.TaskCanceledException] {
  Write-BridgeResult @{ ok = $false; code = "STEAM_TIMEOUT"; message = "Steam Community zaman sınırı içinde yanıt vermedi." }
  exit 0
} catch {
  # İstek başlıkları ve Steam çerezi hata çıktısına kesinlikle eklenmez.
  $safeMessage = switch ($errorCode) {
    "STEAM_URL_REJECTED" { "Güvenli olmayan Steam adresi reddedildi." }
    "STEAM_REDIRECT_LIMIT" { "Steam Community çok fazla yönlendirme yaptı." }
    "STEAM_RESPONSE_TOO_LARGE" { "Steam Community yanıtı güvenli boyut sınırını aştı." }
    default { "Windows sistem ağı Steam Community isteğini tamamlayamadı." }
  }
  Write-BridgeResult @{ ok = $false; code = $errorCode; message = $safeMessage }
  exit 0
} finally {
  if ($null -ne $memory) { $memory.Dispose() }
  if ($null -ne $stream) { $stream.Dispose() }
  if ($null -ne $response) { $response.Dispose() }
  if ($null -ne $client) { $client.Dispose() }
  if ($null -ne $handler) { $handler.Dispose() }
}
