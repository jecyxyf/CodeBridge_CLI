#requires -Version 5.1
<#
.SYNOPSIS
Installs CodeBridge's local web UI and creates Start-CodeBridge.cmd.
.DESCRIPTION
Uses user-scoped Python from WinGet if needed and builds the verified CodeBridge rclone patch inside .tools.
No SSH service, firewall, account, or persistent execution-policy changes are made.
.PARAMETER SkipDependencies
Uses existing Python and verified patched rclone; still creates .venv and installs Python requirements.
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
                $path = & $py.Source $version -B -c 'import sys; print(sys.executable)' 2>$null
                if ($LASTEXITCODE -eq 0 -and $path) { $candidates += [string]$path }
            } catch { }
        }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            & $candidate -B -c 'import sys, tkinter, venv, ensurepip; assert sys.version_info >= (3, 10)' 2>$null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch { }
    }
    return $null
}
function Test-Rclone {
    $CheckPython = Join-Path $Root '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $CheckPython -PathType Leaf)) { return $false }
    try {
        & $CheckPython -B (Join-Path $Root 'local_client\build_rclone.py') --check *> $null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

try {
    $Python = Find-Python
    if ($CheckOnly) {
        if (-not $Python) { throw 'Python >= 3.10 with tkinter and venv is missing.' }
        if (-not (Test-Rclone)) { throw 'Verified CodeBridge rclone build is missing. Run this installer without -CheckOnly.' }
        $VenvPython = Join-Path $Root '.venv\Scripts\python.exe'
        if (Test-Path -LiteralPath $VenvPython) {
            & $VenvPython -B -c "import tkinter, paramiko, socks; print('Client imports OK')"
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
    $Venv = Join-Path $Root '.venv'
    $VenvPython = Join-Path $Venv 'Scripts\python.exe'
    if ((Test-Path -LiteralPath $Venv) -and -not (Test-Path -LiteralPath $VenvPython)) { throw 'Existing .venv is incompatible with Windows. Rename it before rerunning; it was not deleted.' }
    & $Python -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated .venv.' }
    & $VenvPython -m pip install --disable-pip-version-check -r (Join-Path $Root 'local_client\requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Python requirements installation failed.' }
    & $VenvPython -c "import tkinter, paramiko, socks; print('Client dependencies OK')"
    if ($LASTEXITCODE -ne 0) { throw 'Client dependency verification failed.' }
    if (-not (Test-Rclone)) {
        if ($SkipDependencies) { throw 'Verified patched rclone is required. Run without -SkipDependencies to build it inside .tools.' }
        & $VenvPython (Join-Path $Root 'local_client\build_rclone.py')
        if ($LASTEXITCODE -ne 0) { throw 'Patched rclone build failed.' }
    }
    if (-not (Test-Rclone)) { throw 'Patched rclone build verification failed.' }
    Push-Location $Root
    try {
        & $VenvPython -m local_client.rclone_check --rclone (Join-Path $ToolsDir 'rclone.exe')
        if ($LASTEXITCODE -ne 0) { throw 'SFTP read/write self-check failed.' }
    } finally { Pop-Location }
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
