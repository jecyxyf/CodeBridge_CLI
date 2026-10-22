#requires -Version 5.1
<#
.SYNOPSIS
Installs the per-user CodeBridge remote mount adapter and SSHFS dependencies.
.DESCRIPTION
Run as the same Windows user used for SSH. Driver installers may request UAC/reboot.
This script does not install/start OpenSSH, open firewall ports, modify authentication,
change system permissions, or install a CodeBridge service/UI.
.PARAMETER SkipDependencies
Uses existing Python, WinFsp and SSHFS-Win; copies only the per-user adapter.
.PARAMETER CheckOnly
Checks existing dependencies without installation or filesystem changes.
#>
[CmdletBinding()]
param([switch]$SkipDependencies, [switch]$CheckOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Source = Join-Path $Root 'remote_server\mount.py'
$LoggingSource = Join-Path $Root 'codebridge_logging.py'
$Venv = Join-Path $Root '.venv'
$VenvPython = Join-Path $Venv 'Scripts\python.exe'
$env:PYTHONUTF8 = '1'
function Refresh-ProcessPath {
    $env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'User') + ";$env:PATH"
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
            & $candidate -B -c 'import sys, venv, ensurepip; assert sys.version_info >= (3, 10)' 2>$null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch { }
    }
    return $null
}
function Find-SSHFS {
    $candidates = @((Join-Path $env:ProgramFiles 'SSHFS-Win\bin\sshfs.exe'))
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'SSHFS-Win\bin\sshfs.exe') }
    $command = Get-Command sshfs -CommandType Application -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return $null
}
function Test-WinFsp {
    foreach ($key in @('HKLM:\SOFTWARE\WinFsp', 'HKLM:\SOFTWARE\WOW6432Node\WinFsp')) {
        if (Test-Path -LiteralPath $key) { return $true }
    }
    foreach ($programs in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($programs -and (Test-Path -LiteralPath (Join-Path $programs 'WinFsp\bin'))) { return $true }
    }
    return $false
}
function Install-WinGetPackage([string]$Id, [switch]$UserScope) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { throw 'WinGet is missing. Install/update Microsoft App Installer, or install official Python, WinFsp and SSHFS-Win packages manually, then rerun -SkipDependencies.' }
    Write-Host "Installing $Id with WinGet. Review source/package agreements and UAC prompts."
    $arguments = @('install', '--exact', '--id', $Id, '--source', 'winget')
    if ($UserScope) { $arguments += @('--scope', 'user') }
    & $winget.Source @arguments
    if ($LASTEXITCODE -notin @(0, 3010, 1641)) { throw "$Id installer failed with exit code $LASTEXITCODE." }
    if ($LASTEXITCODE -in @(3010, 1641)) { Write-Warning 'An installer requested a reboot. Reboot before testing a mount.' }
    Refresh-ProcessPath
}
function Assert-RealDirectory([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing a non-directory or reparse-point installation path: $Path"
        }
    } else { New-Item -ItemType Directory -Path $Path | Out-Null }
}
function Assert-OrdinaryFile([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing a directory or reparse-point installation file: $Path"
        }
    }
}
function Convert-CmdPath([string]$Path) {
    # Keep non-ASCII account names in environment expansion, not batch-file literals.
    if ($Path.StartsWith($env:USERPROFILE + '\', [StringComparison]::OrdinalIgnoreCase)) {
        return '%USERPROFILE%' + $Path.Substring($env:USERPROFILE.Length).Replace('%', '%%')
    }
    return $Path.Replace('%', '%%')
}
function Assert-ProjectVenv {
    if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
        throw 'Repository .venv is missing or incompatible. Run the installer first; -CheckOnly never creates it.'
    }
    $item = Get-Item -LiteralPath $Venv -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The repository .venv cannot be a reparse point.' }
    & $VenvPython -B -c 'import pathlib, sys; assert sys.version_info >= (3, 10); assert sys.prefix != sys.base_prefix; assert pathlib.Path(sys.prefix).resolve() == pathlib.Path(sys.argv[1]).resolve()' $Venv
    if ($LASTEXITCODE -ne 0) { throw 'Existing .venv is incompatible. It was not deleted; inspect it before retrying.' }
}
try {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf) -or -not (Test-Path -LiteralPath $LoggingSource -PathType Leaf)) { throw 'Extract the complete CodeBridge package first.' }
    $Python = Find-Python
    if (-not $CheckOnly -and -not $SkipDependencies) {
        if (-not $Python) { Install-WinGetPackage 'Python.Python.3.13' -UserScope; $Python = Find-Python }
        if (-not (Test-WinFsp)) { Install-WinGetPackage 'WinFsp.WinFsp' }
        if (-not (Find-SSHFS)) { Install-WinGetPackage 'SSHFS-Win.SSHFS-Win' }
    }
    if (-not $Python) { throw 'Python >= 3.10 is required. Set CODEBRIDGE_PYTHON to a specific python.exe if needed.' }
    if (-not (Test-Path -LiteralPath $Venv) -and -not $CheckOnly) {
        & $Python -m venv $Venv
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the repository .venv.' }
    }
    Assert-ProjectVenv
    if (-not (Test-WinFsp)) { throw 'WinFsp installation was not found. See https://winfsp.dev/rel/ .' }
    $SSHFS = Find-SSHFS
    if (-not $SSHFS) { throw 'SSHFS-Win was not found. See https://github.com/winfsp/sshfs-win/releases .' }
    $SshfsDirectory = Split-Path -Parent $SSHFS
    $env:PATH = "$SshfsDirectory;$env:PATH"
    # Probes installed sshfs.exe for passive/slave support. Never uses net use or a TCP workaround.
    & $VenvPython -B $Source --self-test
    if ($LASTEXITCODE -ne 0) { throw 'Installed SSHFS-Win failed the passive-mode dependency check. Review the output above; a driver reboot may be needed.' }
    if ($CheckOnly) {
        Write-Host 'Dependency check passed; actual mounting and Windows logon-session visibility still need a connection test.'
        exit 0
    }
    $Base = Join-Path $env:USERPROFILE '.codebridge'
    $TargetDir = Join-Path $Base 'remote_server'
    Assert-RealDirectory $Base
    Assert-RealDirectory $TargetDir
    $Target = Join-Path $TargetDir 'mount.py'
    $LoggingTarget = Join-Path $TargetDir 'codebridge_logging.py'
    $Wrapper = Join-Path $Base 'codebridge-mount.cmd'
    Assert-OrdinaryFile $Target
    Assert-OrdinaryFile $LoggingTarget
    Assert-OrdinaryFile $Wrapper
    Copy-Item -LiteralPath $Source -Destination $Target -Force
    Copy-Item -LiteralPath $LoggingSource -Destination $LoggingTarget -Force
    $PythonCmd = Convert-CmdPath $VenvPython
    $SshfsCmd = Convert-CmdPath $SshfsDirectory
    $launcher = @"
@echo off
setlocal
chcp 65001 >nul 2>&1
set "PYTHONUTF8=1"
set "PATH=$SshfsCmd;%PATH%"
"$PythonCmd" "%~dp0remote_server\mount.py" %*
exit /b %errorlevel%
"@
    [IO.File]::WriteAllText($Wrapper, ($launcher -replace "`r?`n", "`r`n"), (New-Object Text.UTF8Encoding($false)))
    Write-Host "Installed helper: $Target"
    Write-Host "Installed launcher: $Wrapper"
    $sshd = Get-Service -Name sshd -ErrorAction SilentlyContinue
    if (-not $sshd -or $sshd.Status -ne 'Running') {
        Write-Warning 'OpenSSH Server is not running. Ask the host administrator to configure existing SSH access before connecting; this script did not change it.'
    }
    Write-Warning 'Windows remote mounts are provisional: a drive created in an SSH session may not be visible to interactive desktop applications or a different logon session. Test with the actual consuming process.'
    Write-Host 'No SSH/firewall/authentication/ACL/security settings were changed. No remote UI or CodeBridge background agent was installed.'
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
