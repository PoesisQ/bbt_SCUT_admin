# Build browser-size PNGs from the approved painted master. No model or external files are changed.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$scutRoot = Split-Path -Parent $PSScriptRoot
$scutMaster = [System.Drawing.Image]::FromFile((Join-Path $scutRoot 'assets\identity\painted-master.png'))
try {
    foreach ($scutSize in @(16,32,48,128,512)) {
        $scutBitmap = New-Object System.Drawing.Bitmap($scutSize,$scutSize)
        $scutGraphics = [System.Drawing.Graphics]::FromImage($scutBitmap)
        try {
            $scutGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $scutGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $scutGraphics.DrawImage($scutMaster,0,0,$scutSize,$scutSize)
            $scutBitmap.Save((Join-Path $scutRoot ('extension\icons\assistant-' + $scutSize + '.png')),[System.Drawing.Imaging.ImageFormat]::Png)
            if ($scutSize -eq 512) { $scutBitmap.Save((Join-Path $scutRoot 'extension\brand.png'),[System.Drawing.Imaging.ImageFormat]::Png) }
        } finally { $scutGraphics.Dispose(); $scutBitmap.Dispose() }
    }
} finally { $scutMaster.Dispose() }
Write-Host 'Painted icon sizes rebuilt.'
