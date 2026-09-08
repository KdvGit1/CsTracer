param(
  [Parameter(Mandatory = $true)][string]$InputJson,
  [Parameter(Mandatory = $true)][string]$OutputPng
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
# Local drawing only; no remote fonts, avatars or image services.
$model = Get-Content -LiteralPath $InputJson -Raw -Encoding UTF8 | ConvertFrom-Json
$ownRows = @($model.ownRows | Select-Object -First 5)
$opponentRows = @($model.opponentRows | Select-Object -First 5)
$width = 1600
$reactionY = 384 + ([Math]::Max(1, $ownRows.Count) * 136)
$reactionHeight = 450
$opponentY = $reactionY + $reactionHeight + 24
$opponentHeight = 90 + ([Math]::Max(1, $opponentRows.Count) * 40)
$height = $opponentY + $opponentHeight + 166
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$brushes = @{}
$fonts = @{}

function Brush([string]$Color) {
  if (-not $brushes.ContainsKey($Color)) { $brushes[$Color] = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($Color)) }
  return $brushes[$Color]
}
function Font([int]$Size, [bool]$Bold = $false) {
  $key = "$Size-$Bold"
  if (-not $fonts.ContainsKey($key)) {
    $style = if ($Bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $fonts[$key] = New-Object System.Drawing.Font 'Segoe UI', $Size, $style, ([System.Drawing.GraphicsUnit]::Pixel)
  }
  return $fonts[$key]
}
function Draw-Text([string]$Text, [single]$X, [single]$Y, [single]$Width, [int]$Size = 22, [string]$Color = '#EEF3F0', [bool]$Bold = $false, [string]$Align = 'Near') {
  $format = New-Object System.Drawing.StringFormat
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
  $format.Alignment = [System.Drawing.StringAlignment]::$Align
  $rectangle = New-Object System.Drawing.RectangleF $X, $Y, $Width, ([single]($Size * 1.65))
  try { $graphics.DrawString(($Text -replace '[\r\n\t]+', ' '), (Font $Size $Bold), (Brush $Color), $rectangle, $format) }
  finally { $format.Dispose() }
}
function Panel([single]$X, [single]$Y, [single]$Width, [single]$Height, [string]$Color, [int]$Radius = 14, [string]$Border = '#29352F') {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $Radius * 2
  $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($Border)), 1
  try {
    $path.AddArc($X, $Y, $d, $d, 180, 90)
    $path.AddArc(($X + $Width - $d), $Y, $d, $d, 270, 90)
    $path.AddArc(($X + $Width - $d), ($Y + $Height - $d), $d, $d, 0, 90)
    $path.AddArc($X, ($Y + $Height - $d), $d, $d, 90, 90)
    $path.CloseFigure()
    $graphics.FillPath((Brush $Color), $path)
    $graphics.DrawPath($pen, $path)
  } finally { $pen.Dispose(); $path.Dispose() }
}
function Initials([string]$Name) {
  $enumerator = [System.Globalization.StringInfo]::GetTextElementEnumerator($Name)
  $letters = ''
  for ($i = 0; $i -lt 2 -and $enumerator.MoveNext(); $i++) { $letters += $enumerator.GetTextElement() }
  return $letters.ToUpper([System.Globalization.CultureInfo]::GetCultureInfo('tr-TR'))
}
try {
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#0A100E'))
  $graphics.FillRectangle((Brush '#C8F54D'), 48, 41, 5, 30)
  Draw-Text 'TRACER' 68 36 250 28 '#C8F54D' $true
  Draw-Text 'CS2 / MAÇ SONU RAPORU' 1060 43 492 18 '#98A99E' $false 'Far'
  Panel 48 96 1504 146 '#14201A' 18 '#3C5037'
  Draw-Text 'HARİTA' 74 114 700 16 '#A8BE9C' $true
  $map = if ($model.mapName) { [string]$model.mapName } else { ([string]$model.title -split ' · ')[0] }
  Draw-Text $map 70 134 850 48 '#F0F6EB' $true
  Draw-Text ([string]$model.subtitle) 74 204 925 19 '#A2B2A8'
  $resultColor = if ($model.result -match 'Galibiyet') { '#C8F54D' } elseif ($model.result -match 'Mağlubiyet') { '#FF9093' } else { '#D8C98C' }
  Panel 1090 112 444 114 '#0B1410' 12 '#334631'
  Draw-Text $(if ($model.scoreText) { [string]$model.scoreText } else { '—' }) 1106 112 412 58 '#F3F7EE' $true 'Center'
  Draw-Text ([string]$model.result) 1108 184 408 22 $resultColor $true 'Center'
  Draw-Text 'SENİN TAKIMIN' 48 272 370 26 '#C8F54D' $true
  Draw-Text ([string]$model.ownSummary) 440 280 1112 20 '#AAB9AF' $false 'Far'
  $columns = @(
    @{ Label = 'OYUNCU'; X = 132; W = 280; Field = 'name'; Align = 'Near' },
    @{ Label = 'K / D / A'; X = 444; W = 164; Field = 'kda'; Align = 'Center' },
    @{ Label = 'ADR'; X = 646; W = 118; Field = 'adr'; Align = 'Center' },
    @{ Label = 'HS'; X = 808; W = 108; Field = 'hs'; Align = 'Center' },
    @{ Label = 'KAST'; X = 968; W = 142; Field = 'kast'; Align = 'Center' },
    @{ Label = 'DÜELLO'; X = 1150; W = 360; Field = 'duel'; Align = 'Center' }
  )
  foreach ($column in $columns) { Draw-Text $column.Label $column.X 324 $column.W 17 '#90A298' $true $column.Align }
  $index = 0
  foreach ($row in $ownRows) {
    $y = 360 + ($index * 136)
    $panelColor = if ($row.highlighted) { '#1B2A1B' } elseif ($index % 2 -eq 0) { '#141D18' } else { '#111A16' }
    $borderColor = if ($row.highlighted) { '#6B8740' } else { '#2A3830' }
    Panel 48 $y 1504 128 $panelColor 12 $borderColor
    if ($row.highlighted) { $graphics.FillRectangle((Brush '#C8F54D'), 48, ($y + 16), 4, 36) }
    Panel 68 ($y + 14) 46 42 $(if ($row.highlighted) { '#C8F54D' } else { '#26392B' }) 8 $borderColor
    Draw-Text (Initials ([string]$row.name)) 69 ($y + 22) 44 18 $(if ($row.highlighted) { '#17200D' } else { '#C3D7B5' }) $true 'Center'
    Draw-Text ([string]$row.name) 132 ($y + 17) $(if ($row.highlighted) { 230 } else { 280 }) 27 '#F0F5EE' $true
    if ($row.highlighted) { Draw-Text 'SEN' 366 ($y + 25) 56 14 '#C8F54D' $true }
    foreach ($column in $columns | Select-Object -Skip 1) {
      $color = if ($column.Field -eq 'kast') { [string]$row.kastColor } else { '#EEF3F0' }
      if ($color -notmatch '^#[0-9A-Fa-f]{6}$') { $color = '#98A99E' }
      $value = [string]$row.($column.Field)
      if ($column.Field -eq 'duel') { $value = $value -replace '\(n(\d+)\)', '($1 örnek)' }
      Draw-Text $value $column.X ($y + 14) $column.W $(if ($column.Field -eq 'duel') { 26 } else { 30 }) $color $true $column.Align
    }
    $details = @(
      @{ Label = 'HAYATTA'; Value = $row.survival }, @{ Label = 'İLK DÜELLO K / D'; Value = $row.opening },
      @{ Label = 'TAKAS'; Value = $row.trade }, @{ Label = 'BOMBA HASARI'; Value = $row.utility },
      @{ Label = 'FLAŞ SÜRESİ'; Value = $row.flash }, @{ Label = 'HAREKET KONTROLÜ'; Value = $row.movement },
      @{ Label = 'BURST / SPREY'; Value = $row.spray }
    )
    for ($i = 0; $i -lt $details.Count; $i++) {
      $x = 70 + ($i * 211)
      Draw-Text $details[$i].Label $x ($y + 61) 201 14 '#92A79A' $true
      Draw-Text ([string]$details[$i].Value) $x ($y + 78) 201 20 '#C9D6CC'
    }
    Draw-Text ('NOT  /  ' + [string]$row.note) 70 ($y + 104) 1458 16 '#B0C79D'
    $index++
  }
  if ($ownRows.Count -eq 0) { Draw-Text 'Bu analizde takım oyuncuları doğrulanamadı.' 70 402 1440 25 '#AAB9AF' }
  Panel 48 $reactionY 1504 $reactionHeight '#101C23' 14 '#334958'
  Draw-Text 'TEPKİ SÜRESİ / GÖRÜNÜRLÜKTEN İLK ATEŞE' 70 ($reactionY + 15) 1450 23 '#68D4FF' $true
  Draw-Text 'Yaklaşık demo ölçümü · prefire ve belirsiz başlangıçlar hariç · eksik ölçüm sıfır değildir' 70 ($reactionY + 48) 1450 17 '#A6BCCB'
  $focusRow = $ownRows | Where-Object { $_.highlighted } | Select-Object -First 1
  if (-not $focusRow) { $focusRow = $ownRows | Select-Object -First 1 }
  $focusSamples = @($focusRow.reaction.samples | Where-Object { $null -ne $_ -and $null -ne $_.ms -and [double]$_.ms -ge 50 -and [double]$_.ms -le 1500 })
  Draw-Text ([string]$focusRow.name + ' / temas sırası') 100 ($reactionY + 84) 840 18 '#D9E6EE' $true
  $chartMax = 500
  if ($focusSamples.Count -gt 0) { $chartMax = [Math]::Max(500, [Math]::Ceiling(($focusSamples | Measure-Object -Property ms -Maximum).Maximum / 100) * 100) }
  foreach ($ratio in @(0, 0.25, 0.5, 0.75, 1)) {
    $gridY = $reactionY + 295 - $ratio * 170
    $graphics.FillRectangle((Brush '#2B414E'), 144, [single]$gridY, 785, 1)
    Draw-Text ([string]([int]($chartMax * $ratio))) 73 ($gridY - 10) 63 16 '#8BA6B6'
  }
  if ($focusSamples.Count -gt 0 -and $null -ne $focusRow.reaction.medianMs) {
    $medianY = $reactionY + 295 - [double]$focusRow.reaction.medianMs / $chartMax * 170
    $medianPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#779451')), 1
    $medianPen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
    try { $graphics.DrawLine($medianPen, [single]144, [single]$medianY, [single]929, [single]$medianY) } finally { $medianPen.Dispose() }
    Draw-Text ('Medyan ' + [string]$focusRow.reaction.medianMs + ' ms') 655 ([Math]::Max($reactionY + 112, $medianY - 24)) 270 16 '#B9EE64' $true 'Far'
  }
  for ($si = 0; $si -lt $focusSamples.Count; $si++) {
    $sx = 155 + $si * 760 / [Math]::Max(1, $focusSamples.Count - 1)
    $sy = $reactionY + 295 - [double]$focusSamples[$si].ms / $chartMax * 170
    if ($si -gt 0) {
      $trendPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#7B9D59')), 2
      try { $graphics.DrawLine($trendPen, [single]$previousX, [single]$previousY, [single]$sx, [single]$sy) } finally { $trendPen.Dispose() }
    }
    $graphics.FillEllipse((Brush '#B9EE64'), [single]($sx - 5), [single]($sy - 5), 10, 10)
    $previousX = $sx; $previousY = $sy
    if ($si % [Math]::Max(1, [Math]::Ceiling($focusSamples.Count / 10)) -eq 0) { Draw-Text ([string]($si + 1)) ($sx - 18) ($reactionY + 301) 44 16 '#8BA6B6' }
  }
  if ($focusSamples.Count -eq 0) { Draw-Text 'Geçerli tepki örneği bulunamadı.' 180 ($reactionY + 195) 690 24 '#8BA6B6' }
  Draw-Text 'TAKIM / MEDYAN' 1000 ($reactionY + 84) 500 18 '#D9E6EE' $true
  $ri = 0
  foreach ($row in $ownRows) {
    $ry = $reactionY + 120 + $ri * 39
    $samples = @($row.reaction.samples | Where-Object { $null -ne $_ -and $null -ne $_.ms -and [double]$_.ms -ge 50 -and [double]$_.ms -le 1500 })
    $label = if ($samples.Count -gt 0) { ([string]$row.reaction.medianMs + ' ms / ' + $samples.Count + ' temas') } else { 'Ölçülemedi / 0 temas' }
    Draw-Text ([string]$row.name) 1000 $ry 240 18 '#D9E6EE' $true
    Draw-Text $label 1250 $ry 276 17 '#B9CEDC'
    $ri++
  }
  $bins = @($focusRow.reaction.histogram | Where-Object { $null -ne $_ })
  $binLabels = @('50–150 ms', '150–250 ms', '250–400 ms', '400–700 ms', '700–1500 ms')
  for ($bi = 0; $bi -lt [Math]::Min(5, $bins.Count); $bi++) {
    $bx = 95 + $bi * 285
    $bw = [Math]::Max(0, [double]$bins[$bi].count) / [Math]::Max(1, $focusSamples.Count) * 235
    Draw-Text $binLabels[$bi] $bx ($reactionY + 345) 260 16 '#8BA6B6'
    $graphics.FillRectangle((Brush '#253A2D'), [single]$bx, [single]($reactionY + 373), 235, 12)
    $graphics.FillRectangle((Brush '#B9EE64'), [single]$bx, [single]($reactionY + 373), [single]$bw, 12)
    Draw-Text ([string]$bins[$bi].count + ' temas') $bx ($reactionY + 390) 260 18 '#D9E6EE'
  }
  Panel 48 $opponentY 1504 $opponentHeight '#101916' 14 '#38433A'
  Draw-Text 'RAKİP TAKIM' 70 ($opponentY + 18) 380 23 '#CFBE90' $true
  Draw-Text ([string]$model.opponentSummary) 470 ($opponentY + 24) 1060 19 '#97A89D' $false 'Far'
  $enemyColumns = @(
    @{ Label = 'OYUNCU'; X = 72; W = 460; Field = 'name'; Align = 'Near' },
    @{ Label = 'K / D / A'; X = 550; W = 180; Field = 'kda'; Align = 'Center' },
    @{ Label = 'ADR'; X = 770; W = 120; Field = 'adr'; Align = 'Center' },
    @{ Label = 'KAST'; X = 950; W = 130; Field = 'kast'; Align = 'Center' },
    @{ Label = 'ROUND KATKISI'; X = 1140; W = 382; Field = 'grade'; Align = 'Near' }
  )
  foreach ($column in $enemyColumns) { Draw-Text $column.Label $column.X ($opponentY + 59) $column.W 14 '#81978B' $true $column.Align }
  $index = 0
  foreach ($row in $opponentRows) {
    $y = $opponentY + 84 + ($index * 40)
    if ($index % 2 -eq 0) { $graphics.FillRectangle((Brush '#18231D'), 64, $y, 1472, 38) }
    foreach ($column in $enemyColumns) { Draw-Text ([string]$row.($column.Field)) $column.X ($y + 5) $column.W 22 '#CCD6CE' ($column.Field -eq 'name') $column.Align }
    $index++
  }
  if ($opponentRows.Count -eq 0) { Draw-Text 'Rakip oyuncular bu analizde doğrulanamadı.' 72 ($opponentY + 89) 1400 22 '#97A89D' }
  $footerY = $opponentY + $opponentHeight + 22
  Draw-Text 'İSTATİSTİKLERİ OKUMA REHBERİ' 48 $footerY 1450 15 '#91A784' $true
  Draw-Text 'K / D / A: öldürme / ölüm / asist   ·   ADR: round başına hasar   ·   HS: kafadan öldürme oranı' 48 ($footerY + 24) 1504 18 '#9DAEA2'
  Draw-Text 'KAST: öldürme, asist, hayatta kalma veya takas katkısı olan roundların yüzdesi. Resmî bir seviye puanı değildir.' 48 ($footerY + 49) 1504 18 '#9DAEA2'
  Draw-Text 'Hareket: hız sınırına uygun atış oranı   ·   Burst / sprey: ilk 3 / sonraki mermiler   ·   Düello: kazanma oranı (örnek sayısı)' 48 ($footerY + 74) 1504 17 '#8B9E90'
  Draw-Text '— Ölçülemedi     SEN Seçili oyuncu' 48 ($footerY + 101) 1150 16 '#C0CEB8'
  Draw-Text 'TRACER / MAÇ ANALİZİ' 1190 ($footerY + 101) 362 16 '#819574' $true 'Far'
  $bitmap.Save($OutputPng, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $graphics.Dispose()
  $bitmap.Dispose()
  foreach ($font in $fonts.Values) { $font.Dispose() }
  foreach ($brush in $brushes.Values) { $brush.Dispose() }
}
