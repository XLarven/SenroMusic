Add-Type -AssemblyName System.Drawing

function New-RoundedPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-SenroIcon {
  param([int]$Size, [string]$OutputPath)

  $scale = $Size / 512.0
  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 177, 132),
    [System.Drawing.Color]::FromArgb(178, 76, 214),
    45.0
  )
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
  $blend.Colors = [System.Drawing.Color[]]@(
    [System.Drawing.Color]::FromArgb(255, 177, 132),
    [System.Drawing.Color]::FromArgb(255, 112, 75),
    [System.Drawing.Color]::FromArgb(178, 76, 214)
  )
  $blend.Positions = [single[]]@(0.0, 0.46, 1.0)
  $gradient.InterpolationColors = $blend
  $graphics.FillRectangle($gradient, $rect)

  $whiteGlow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(36, 255, 255, 255))
  $graphics.FillEllipse($whiteGlow, -70 * $scale, -90 * $scale, 430 * $scale, 430 * $scale)
  $whiteGlow.Dispose()

  $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(34, 32, 5, 12))
  $bars = @(
    @(158, 228, 36, 102),
    @(218, 166, 36, 226),
    @(278, 200, 36, 158),
    @(338, 250, 36, 74)
  )

  foreach ($bar in $bars) {
    $shadowPath = New-RoundedPath (($bar[0] + 2) * $scale) (($bar[1] + 10) * $scale) ($bar[2] * $scale) ($bar[3] * $scale) (18 * $scale)
    $graphics.FillPath($shadow, $shadowPath)
    $shadowPath.Dispose()
  }
  $shadow.Dispose()

  $dark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 27, 12, 8))
  $shine = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(52, 255, 255, 255))

  foreach ($bar in $bars) {
    $path = New-RoundedPath ($bar[0] * $scale) ($bar[1] * $scale) ($bar[2] * $scale) ($bar[3] * $scale) (18 * $scale)
    $graphics.FillPath($dark, $path)
    $path.Dispose()

    $shinePath = New-RoundedPath (($bar[0] + 2) * $scale) (($bar[1] + 2) * $scale) (12 * $scale) (($bar[3] - 4) * $scale) (6 * $scale)
    $graphics.FillPath($shine, $shinePath)
    $shinePath.Dispose()
  }

  $dark.Dispose()
  $shine.Dispose()
  $gradient.Dispose()
  $graphics.Dispose()

  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

$publicDir = Join-Path $PSScriptRoot '..\public'
$publicDir = [System.IO.Path]::GetFullPath($publicDir)
New-SenroIcon -Size 192 -OutputPath (Join-Path $publicDir 'icon-192.png')
New-SenroIcon -Size 512 -OutputPath (Join-Path $publicDir 'icon-512.png')
Write-Output "Icons written to $publicDir"
