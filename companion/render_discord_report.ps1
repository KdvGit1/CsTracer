param(
  [Parameter(Mandatory = $true)][string]$InputJson,
  [Parameter(Mandatory = $true)][string]$OutputPng
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-Brush([string]$Hex) {
  return New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($Hex))
}

function Draw-FitText {
  param(
    [System.Drawing.Graphics]$Graphics,
    [string]$Text,
    [System.Drawing.Font]$Font,
    [System.Drawing.Brush]$Brush,
    [single]$X,
    [single]$Y,
    [single]$MaxWidth
  )
  if ($null -eq $Text) { $Text = '' }
  $candidate = [string]$Text
  while ($candidate.Length -gt 1 -and $Graphics.MeasureString($candidate, $Font).Width -gt $MaxWidth) {
    $candidate = $candidate.Substring(0, $candidate.Length - 1)
  }
  if ($candidate -ne $Text -and $candidate.Length -gt 1) {
    $candidate = $candidate.Substring(0, $candidate.Length - 1).TrimEnd() + '…'
  }
  $Graphics.DrawString($candidate, $Font, $Brush, $X, $Y)
}

$model = Get-Content -LiteralPath $InputJson -Raw -Encoding UTF8 | ConvertFrom-Json
$width = 1800
$height = 1160
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$fonts = @{
  Brand = New-Object System.Drawing.Font 'Segoe UI', 22, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  Title = New-Object System.Drawing.Font 'Segoe UI', 34, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  Section = New-Object System.Drawing.Font 'Segoe UI', 23, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  Header = New-Object System.Drawing.Font 'Segoe UI', 14, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  Cell = New-Object System.Drawing.Font 'Segoe UI', 18, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
  CellBold = New-Object System.Drawing.Font 'Segoe UI', 18, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  Small = New-Object System.Drawing.Font 'Segoe UI', 15, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
}
$brushes = @{
  Background = New-Brush '#090D0C'
  Panel = New-Brush '#111715'
  PanelAlt = New-Brush '#151D1A'
  Header = New-Brush '#1C2722'
  Acid = New-Brush '#C8F54D'
  White = New-Brush '#F2F6F3'
  Muted = New-Brush '#96A39C'
  Grid = New-Brush '#26322D'
  Win = New-Brush '#66D98A'
  Loss = New-Brush '#FF6F77'
  Amber = New-Brush '#F4C95D'
}

try {
  $graphics.FillRectangle($brushes.Background, 0, 0, $width, $height)
  $graphics.FillRectangle($brushes.Header, 0, 0, $width, 112)
  $graphics.DrawString('TRACER', $fonts.Brand, $brushes.Acid, 48, 20)
  Draw-FitText $graphics ([string]$model.title) $fonts.Title $brushes.White 220 14 1510
  Draw-FitText $graphics ([string]$model.subtitle) $fonts.Cell $brushes.Muted 220 65 1510

  $graphics.FillRectangle($brushes.Panel, 36, 132, 1728, 558)
  $graphics.DrawString('BİZİM TAKIM · AYRINTILI OYUNCU KARTLARI', $fonts.Section, $brushes.Acid, 54, 146)
  Draw-FitText $graphics ([string]$model.ownSummary) $fonts.Small $brushes.Muted 720 151 1010

  $ownColumns = @(
    @{ Label = 'OYUNCU'; X = 54; Width = 205 }, @{ Label = 'K / D / A'; X = 270; Width = 108 },
    @{ Label = 'ADR'; X = 388; Width = 74 }, @{ Label = 'HS'; X = 472; Width = 72 },
    @{ Label = 'KAST'; X = 554; Width = 88 }, @{ Label = 'HAYATTA'; X = 652; Width = 94 },
    @{ Label = 'OPEN'; X = 756; Width = 82 }, @{ Label = 'TRADE'; X = 848; Width = 86 },
    @{ Label = 'UTIL'; X = 944; Width = 76 }, @{ Label = 'FLASH'; X = 1030; Width = 80 },
    @{ Label = 'HAREKET'; X = 1120; Width = 98 }, @{ Label = 'SPREY'; X = 1228; Width = 110 },
    @{ Label = 'DÜELLO'; X = 1348; Width = 98 }, @{ Label = 'KOÇ NOTU'; X = 1456; Width = 272 }
  )
  $graphics.FillRectangle($brushes.Header, 48, 188, 1704, 40)
  foreach ($column in $ownColumns) {
    Draw-FitText $graphics ([string]$column.Label) $fonts.Header $brushes.Muted ([single]$column.X) 198 ([single]$column.Width)
  }

  $rowIndex = 0
  foreach ($row in @($model.ownRows)) {
    $y = 238 + ($rowIndex * 86)
    if ($row.highlighted) { $graphics.FillRectangle($brushes.PanelAlt, 48, $y, 1704, 78) }
    $graphics.FillRectangle($brushes.Grid, 48, $y + 77, 1704, 1)
    $name = if ($row.highlighted) { '★ ' + [string]$row.name } else { [string]$row.name }
    $values = @($name, $row.kda, $row.adr, $row.hs, $row.kast, $row.survival, $row.opening, $row.trade, $row.utility, $row.flash, $row.movement, $row.spray, $row.duel, $row.note)
    for ($columnIndex = 0; $columnIndex -lt $ownColumns.Count; $columnIndex += 1) {
      $column = $ownColumns[$columnIndex]
      $font = if ($columnIndex -eq 0) { $fonts.CellBold } else { $fonts.Cell }
      $brush = if ($columnIndex -eq 4) { New-Brush ([string]$row.kastColor) } else { $brushes.White }
      try { Draw-FitText $graphics ([string]$values[$columnIndex]) $font $brush ([single]$column.X) ([single]($y + 25)) ([single]$column.Width) }
      finally { if ($columnIndex -eq 4) { $brush.Dispose() } }
    }
    $rowIndex += 1
  }

  $graphics.FillRectangle($brushes.Panel, 36, 710, 1728, 358)
  $graphics.DrawString('RAKİP TAKIM · TEK KISA KART', $fonts.Section, $brushes.Amber, 54, 724)
  Draw-FitText $graphics ([string]$model.opponentSummary) $fonts.Small $brushes.Muted 620 729 1110
  $opponentColumns = @(
    @{ Label = 'OYUNCU'; X = 54; Width = 340 }, @{ Label = 'K / D / A'; X = 410; Width = 190 },
    @{ Label = 'ADR'; X = 620; Width = 150 }, @{ Label = 'KAST'; X = 790; Width = 170 },
    @{ Label = 'ROUND KATKISI'; X = 980; Width = 748 }
  )
  $graphics.FillRectangle($brushes.Header, 48, 766, 1704, 40)
  foreach ($column in $opponentColumns) {
    Draw-FitText $graphics ([string]$column.Label) $fonts.Header $brushes.Muted ([single]$column.X) 776 ([single]$column.Width)
  }
  $opponentIndex = 0
  foreach ($row in @($model.opponentRows)) {
    $y = 816 + ($opponentIndex * 47)
    $graphics.FillRectangle($brushes.Grid, 48, $y + 42, 1704, 1)
    $values = @($row.name, $row.kda, $row.adr, $row.kast, $row.grade)
    for ($columnIndex = 0; $columnIndex -lt $opponentColumns.Count; $columnIndex += 1) {
      $column = $opponentColumns[$columnIndex]
      $font = if ($columnIndex -eq 0) { $fonts.CellBold } else { $fonts.Cell }
      $brush = if ($columnIndex -eq 3) { New-Brush ([string]$row.kastColor) } else { $brushes.White }
      try { Draw-FitText $graphics ([string]$values[$columnIndex]) $font $brush ([single]$column.X) ([single]($y + 10)) ([single]$column.Width) }
      finally { if ($columnIndex -eq 3) { $brush.Dispose() } }
    }
    $opponentIndex += 1
  }
  if (@($model.opponentRows).Count -eq 0) {
    $graphics.DrawString('Rakip kadrosu bu analizde güvenle doğrulanamadı.', $fonts.Cell, $brushes.Muted, 54, 832)
  }

  $graphics.FillRectangle($brushes.Header, 0, 1090, $width, 70)
  Draw-FitText $graphics 'KAST = Kill, Assist, Survived veya Traded olunan roundların yüzdesi · — = Ölçülemedi · ★ = Seçili oyuncu' $fonts.Small $brushes.Muted 48 1113 1704
  $bitmap.Save($OutputPng, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $graphics.Dispose()
  $bitmap.Dispose()
  foreach ($font in $fonts.Values) { $font.Dispose() }
  foreach ($brush in $brushes.Values) { $brush.Dispose() }
}
