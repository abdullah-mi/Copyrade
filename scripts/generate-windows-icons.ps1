Add-Type -AssemblyName System.Drawing

$repository = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repository 'artwork\Copyrade Mark.png'
$outputDirectory = Join-Path $repository 'apps\desktop\assets'
$iconPath = Join-Path $outputDirectory 'copyrade.ico'
$trayPath = Join-Path $outputDirectory 'copyrade-tray.png'
$sizes = @(16, 24, 32, 48, 64, 128, 256)

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

function New-IconPng([System.Drawing.Image]$source, [int]$size) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $scale = [Math]::Min(($size * 0.90) / $source.Width, ($size * 0.90) / $source.Height)
        $width = [single]($source.Width * $scale)
        $height = [single]($source.Height * $scale)
        $graphics.DrawImage($source, [single](($size - $width) / 2), [single](($size - $height) / 2), $width, $height)
        $stream = New-Object System.IO.MemoryStream
        try {
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            return $stream.ToArray()
        } finally {
            $stream.Dispose()
        }
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
    $images = foreach ($size in $sizes) {
        [PSCustomObject]@{ Size = $size; Bytes = (New-IconPng $source $size) }
    }
} finally {
    $source.Dispose()
}

[System.IO.File]::WriteAllBytes($trayPath, ($images | Where-Object Size -eq 64).Bytes)

$stream = [System.IO.File]::Create($iconPath)
$writer = New-Object System.IO.BinaryWriter($stream)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$images.Count)

    $offset = 6 + 16 * $images.Count
    foreach ($entry in $images) {
        $dimension = if ($entry.Size -eq 256) { 0 } else { $entry.Size }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$entry.Bytes.Length)
        $writer.Write([uint32]$offset)
        $offset += $entry.Bytes.Length
    }
    foreach ($entry in $images) {
        $writer.Write([byte[]]$entry.Bytes)
    }
} finally {
    $writer.Dispose()
}

Write-Output "Generated $iconPath and $trayPath"
