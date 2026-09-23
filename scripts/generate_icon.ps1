# Build every browser and Android icon from the approved transparent master.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$scutRoot = Split-Path -Parent $PSScriptRoot
$scutMasterPath = Join-Path $scutRoot 'assets\identity\painted-master.png'
$scutMaster = [System.Drawing.Image]::FromFile($scutMasterPath)

function New-ScutCanvas([int]$Size) {
    return New-Object System.Drawing.Bitmap($Size,$Size,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function Set-ScutQuality([System.Drawing.Graphics]$Graphics) {
    $Graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
}

function Save-ScutTransparent([string]$Path,[int]$Size) {
    $bitmap = New-ScutCanvas $Size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        Set-ScutQuality $graphics
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.DrawImage($scutMaster,0,0,$Size,$Size)
        $bitmap.Save($Path,[System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}

function Save-ScutLauncher([string]$Path,[int]$Size,[bool]$Round) {
    $bitmap = New-ScutCanvas $Size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $background = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#FFF9F3'))
    $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
    try {
        Set-ScutQuality $graphics
        $graphics.Clear([System.Drawing.Color]::Transparent)
        if ($Round) {
            $graphics.FillEllipse($background,0,0,$Size,$Size)
        } else {
            $radius = [single]($Size * .23)
            $diameter = [single]($radius * 2)
            $edge = [single]($Size - $diameter)
            $shape.AddArc(0,0,$diameter,$diameter,180,90)
            $shape.AddArc($edge,0,$diameter,$diameter,270,90)
            $shape.AddArc($edge,$edge,$diameter,$diameter,0,90)
            $shape.AddArc(0,$edge,$diameter,$diameter,90,90)
            $shape.CloseFigure()
            $graphics.FillPath($background,$shape)
        }
        $inset = [int][Math]::Round($Size * .07)
        $draw = $Size - (2 * $inset)
        $graphics.DrawImage($scutMaster,$inset,$inset,$draw,$draw)
        $bitmap.Save($Path,[System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $shape.Dispose(); $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}

try {
    foreach ($scutSize in @(16,32,48,128,512)) {
        $path = Join-Path $scutRoot ('extension\icons\assistant-' + $scutSize + '.png')
        Save-ScutTransparent $path $scutSize
        if ($scutSize -eq 512) { Save-ScutTransparent (Join-Path $scutRoot 'extension\brand.png') 512 }
    }
    foreach ($scutSize in @(16,48,128)) {
        Save-ScutTransparent (Join-Path $scutRoot ('extension\icons\' + $scutSize + '.png')) $scutSize
    }
    Save-ScutTransparent (Join-Path $scutRoot 'extension\icons\icon.png') 1024
    Save-ScutTransparent (Join-Path $scutRoot 'assets\figures\icon.png') 1024

    Save-ScutTransparent (Join-Path $scutRoot 'mobile\android\app\src\main\res\drawable-nodpi\classroom_mark.png') 1024
    $densities = @{ 'mdpi'=48; 'hdpi'=72; 'xhdpi'=96; 'xxhdpi'=144; 'xxxhdpi'=192 }
    foreach ($density in $densities.Keys) {
        $folder = Join-Path $scutRoot ('mobile\android\app\src\main\res\mipmap-' + $density)
        Save-ScutLauncher (Join-Path $folder 'ic_launcher.png') $densities[$density] $false
        Save-ScutLauncher (Join-Path $folder 'ic_launcher_round.png') $densities[$density] $true
    }
} finally { $scutMaster.Dispose() }

Write-Host 'Browser and Android icon sizes rebuilt.'
