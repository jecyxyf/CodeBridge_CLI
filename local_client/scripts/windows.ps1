#requires -Version 5.1
<#
.SYNOPSIS
Installs CodeBridge's local web UI and creates Start-CodeBridge.cmd.
.DESCRIPTION
Uses user-scoped Python from WinGet if needed and official portable rclone 1.75.2.
No SSH service, firewall, account, or persistent execution-policy changes are made.
.PARAMETER SkipDependencies
Uses existing Python/rclone; still creates .venv and installs Python requirements.
.PARAMETER CheckOnly
Checks dependencies without installing packages or changing files.
#>
[CmdletBinding()]
param([switch]$SkipDependencies, [switch]$CheckOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ToolsDir = Join-Path $Root '.tools'
$env:PATH = "$ToolsDir;$env:PATH"

function Refresh-ProcessPath {
    $env:PATH = "$ToolsDir;" + [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'User') + ";$env:PATH"
}
function Find-Python {
    $candidates = @()
    if ($env:CODEBRIDGE_PYTHON) { $candidates += $env:CODEBRIDGE_PYTHON }
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe')
    foreach ($name in @('python', 'python3')) {
        $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue
        if ($command -and $command.Source -notmatch '\\WindowsApps\\') { $candidates += $command.Source }
    }
    $py = Get-Command py -CommandType Application -ErrorAction SilentlyContinue
    if ($py) {
        foreach ($version in @('-3.13', '-3')) {
            try {
                $path = & $py.Source $version -c 'import sys; print(sys.executable)' 2>$null
                if ($LASTEXITCODE -eq 0 -and $path) { $candidates += [string]$path }
            } catch { }
        }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            & $candidate -c 'import sys, tkinter, venv, ensurepip; assert sys.version_info >= (3, 10)' 2>$null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch { }
    }
    return $null
}
function Test-Rclone {
    $command = Get-Command rclone -CommandType Application -ErrorAction SilentlyContinue
    if (-not $command) { return $false }
    try {
        $version = & $command.Source version 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        $match = [regex]::Match(($version -join "`n"), 'rclone v(\d+)\.(\d+)\.(\d+)')
        if (-not $match.Success) { return $false }
        $number = [version](($match.Groups[1..3] | ForEach-Object { $_.Value }) -join '.')
        if ($number -lt [version]'1.75.0') { return $false }
        $helpText = & $command.Source serve sftp --help 2>$null
        return ($LASTEXITCODE -eq 0 -and ($helpText -join "`n") -match '(?m)--stdio\b')
    } catch { return $false }
}
function Install-OfficialRclone {
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    $arch = switch ($architecture.ToUpperInvariant()) {
        'AMD64' { 'amd64' }
        'ARM64' { 'arm64' }
        'X86' { '386' }
        default { throw "Unsupported processor architecture: $architecture. Install rclone manually from https://rclone.org/downloads/." }
    }
    $version = 'v1.75.2'
    $filename = "rclone-$version-windows-$arch.zip"
    $url = "https://downloads.rclone.org/$version"
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ("codebridge-rclone-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporary | Out-Null
    try {
        # Add TLS 1.2 only for this PowerShell process, not system-wide.
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri "$url/SHA256SUMS" -OutFile (Join-Path $temporary 'SHA256SUMS')
        Invoke-WebRequest -UseBasicParsing -Uri "$url/$filename" -OutFile (Join-Path $temporary $filename)
        $pattern = '^([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($filename) + '$'
        $expected = $null
        foreach ($line in (Get-Content -LiteralPath (Join-Path $temporary 'SHA256SUMS'))) {
            if ($line -match $pattern) { $expected = $Matches[1].ToUpperInvariant() }
        }
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $temporary $filename)).Hash
        if (-not $expected -or $actual -ne $expected) { throw 'Official rclone SHA-256 verification failed. Nothing was installed.' }
        Expand-Archive -LiteralPath (Join-Path $temporary $filename) -DestinationPath $temporary
        New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
        Copy-Item -LiteralPath (Join-Path $temporary "rclone-$version-windows-$arch\rclone.exe") -Destination (Join-Path $ToolsDir 'rclone.exe') -Force
        Write-Host "Installed official rclone $version in $ToolsDir"
    } finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
}

try {
    $Python = Find-Python
    if ($CheckOnly) {
        if (-not $Python) { throw 'Python >= 3.10 with tkinter and venv is missing.' }
        if (-not (Test-Rclone)) { throw 'rclone >= 1.75.0 with serve sftp --stdio is missing.' }
        $VenvPython = Join-Path $Root '.venv\Scripts\python.exe'
        if (Test-Path -LiteralPath $VenvPython) {
            & $VenvPython -c "import tkinter, paramiko, socks; print('Client imports OK')"
            if ($LASTEXITCODE -ne 0) { throw 'Client dependency check failed.' }
        } else { Write-Host 'System dependencies OK; .venv is not installed yet.' }
        exit 0
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Root 'local_client\requirements.txt'))) { throw 'Extract the complete CodeBridge package first.' }
    if (-not $Python -and -not $SkipDependencies) {
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if (-not $winget) { throw 'WinGet is missing. Install/update Microsoft App Installer, or install Python 3.13 from https://www.python.org/downloads/windows/ with Tcl/Tk and rerun.' }
        Write-Host 'Installing user-scoped Python 3.13 with WinGet. Review any installer or source agreements it displays.'
        & $winget.Source install --exact --id Python.Python.3.13 --source winget --scope user
        if ($LASTEXITCODE -notin @(0, 3010, 1641)) { throw "Python installer failed with exit code $LASTEXITCODE." }
        Refresh-ProcessPath
        $Python = Find-Python
    }
    if (-not $Python) { throw 'Python >= 3.10 with Tcl/Tk and venv is required. CODEBRIDGE_PYTHON can point to a specific python.exe.' }
    if (-not (Test-Rclone)) {
        if ($SkipDependencies) { throw 'Install rclone >= 1.75.0 from https://rclone.org/install/ and rerun.' }
        Install-OfficialRclone
    }
    if (-not (Test-Rclone)) { throw 'rclone capability/version verification failed.' }
    $Venv = Join-Path $Root '.venv'
    $VenvPython = Join-Path $Venv 'Scripts\python.exe'
    if ((Test-Path -LiteralPath $Venv) -and -not (Test-Path -LiteralPath $VenvPython)) { throw 'Existing .venv is incompatible with Windows. Rename it before rerunning; it was not deleted.' }
    & $Python -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated .venv.' }
    & $VenvPython -m pip install --disable-pip-version-check -r (Join-Path $Root 'local_client\requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Python requirements installation failed.' }
    & $VenvPython -c "import tkinter, paramiko, socks; print('Client dependencies OK')"
    if ($LASTEXITCODE -ne 0) { throw 'Client dependency verification failed.' }
    $launcher = @'
@echo off
setlocal
set "PATH=%~dp0.tools;%PATH%"
cd /d "%~dp0"
"%~dp0.venv\Scripts\python.exe" -m local_client.app %*
set "codebridge_exit=%errorlevel%"
if not "%codebridge_exit%"=="0" pause
exit /b %codebridge_exit%
'@
    Set-Content -LiteralPath (Join-Path $Root 'Start-CodeBridge.cmd') -Value $launcher -Encoding ASCII
    Write-Host "Installed. Double-click $(Join-Path $Root 'Start-CodeBridge.cmd') to open the local web UI."
    Write-Host 'No SSH, firewall, execution policy, or background service settings were changed.'
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
