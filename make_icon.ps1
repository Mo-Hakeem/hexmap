$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.Drawing

$size = 128
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAlias'
$g.PixelOffsetMode = 'HighQuality'

# ---------- rounded-rect path helper ----------
function New-RoundedRect($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# ---------- background: diagonal gradient, deep blue -> ink ----------
$bgRect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $bgRect,
  ([System.Drawing.Color]::FromArgb(37, 99, 235)),   # blue-600
  ([System.Drawing.Color]::FromArgb(15, 23, 42)),    # slate-900
  45
$g.FillRectangle($bgBrush, $bgRect)
$bgBrush.Dispose()

# subtle top highlight (gradient rect matches fill rect so alpha fades cleanly to 0)
$hlRect = New-Object System.Drawing.Rectangle 0, 0, $size, 56
$hl = New-Object System.Drawing.Drawing2D.LinearGradientBrush $hlRect,
  ([System.Drawing.Color]::FromArgb(80, 255, 255, 255)),
  ([System.Drawing.Color]::FromArgb(0, 255, 255, 255)),
  90
$g.FillRectangle($hl, $hlRect)
$hl.Dispose()

# ---------- big "0x" ----------
$fontBig = New-Object System.Drawing.Font('Consolas', 50, [System.Drawing.FontStyle]::Bold)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'
$fmt.LineAlignment = 'Center'

$white = [System.Drawing.Brushes]::White
$shadowColor = [System.Drawing.Color]::FromArgb(90, 0, 0, 0)
$shadow = New-Object System.Drawing.SolidBrush $shadowColor

# drop shadow
$g.DrawString('0x', $fontBig, $shadow,
  (New-Object System.Drawing.RectangleF 2, 16, $size, 66), $fmt)
$g.DrawString('0x', $fontBig, $white,
  (New-Object System.Drawing.RectangleF 0, 14, $size, 66), $fmt)
$shadow.Dispose()

# ---------- byte cells row ----------
$fontCell = New-Object System.Drawing.Font('Consolas', 10.5, [System.Drawing.FontStyle]::Bold)
$labels  = @('3F','A0','5C','FF')
$colors  = @(
  [System.Drawing.Color]::FromArgb(125, 211, 252),  # sky
  [System.Drawing.Color]::FromArgb(134, 239, 172),  # green
  [System.Drawing.Color]::FromArgb(252, 211, 77),   # amber
  [System.Drawing.Color]::FromArgb(196, 181, 253)   # violet
)
$cellW = 26; $cellH = 22; $gap = 4; $totalW = 4 * $cellW + 3 * $gap
$startX = [int](($size - $totalW) / 2); $y = 90

for ($i = 0; $i -lt 4; $i++) {
  $x = $startX + $i * ($cellW + $gap)
  $path = New-RoundedRect $x $y $cellW $cellH 4
  $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(30, 255, 255, 255))
  $g.FillPath($fill, $path); $fill.Dispose()
  $pen = New-Object System.Drawing.Pen $colors[$i], 1.6
  $g.DrawPath($pen, $path); $pen.Dispose()
  $cb = New-Object System.Drawing.SolidBrush $colors[$i]
  $cf = New-Object System.Drawing.StringFormat
  $cf.Alignment = 'Center'; $cf.LineAlignment = 'Center'
  $cf.FormatFlags = [System.Drawing.StringFormatFlags]::NoClip
  $g.DrawString($labels[$i], $fontCell, $cb,
    (New-Object System.Drawing.RectangleF $x, $y, $cellW, $cellH), $cf)
  $cb.Dispose(); $cf.Dispose(); $path.Dispose()
}

$bmp.Save((Join-Path $root 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $fontBig.Dispose(); $fontCell.Dispose()
Get-Item (Join-Path $root 'icon.png') | Select-Object Name, Length
