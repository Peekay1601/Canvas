@echo off
rem Double-click to let Claude on the web (claude.ai) work on footage on this PC.
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.local\bin;%PATH%"

where uv >nul 2>nul
if errorlevel 1 (
  echo Installing uv ^(runs Python for Rough Cut^)...
  powershell -NoProfile -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
)

set "FOLDER="
for /f "usebackq delims=" %%F in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose the footage folder, with the script inside it, to share with Claude'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"`) do set "FOLDER=%%F"
if not defined FOLDER exit /b 0

uv run --directory "%~dp0." roughcut-mcp web --folder "%FOLDER%"
pause
