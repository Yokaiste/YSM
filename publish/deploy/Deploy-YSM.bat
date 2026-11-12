@echo off
setlocal EnableExtensions DisableDelayedExpansion

:: ============================================================
:: CONFIG - the only section that differs between mods.
:: Copy this installer into another mod and edit only this block.
:: ============================================================
set "REPO_OWNER=Yokaiste"
set "MODS=YSM"
set "MOD_ARGS=--mod ysm"

:: ============================================================
:: Shared logic. Everything below is identical in every mod.
:: ============================================================
set "MOD_ROOT=%~dp0"
if "%MOD_ROOT:~-1%"=="\" set "MOD_ROOT=%MOD_ROOT:~0,-1%"
set "YMB_DIR=%MOD_ROOT%\YMB"
set "TEMP_DIR=%TEMP%\ymb-deploy-%RANDOM%-%RANDOM%"

call :check_placement || goto failed
call :check_tools || goto failed
call :install_ymb || goto failed
for %%M in (%MODS%) do (
  call :install_mod %%M
  if errorlevel 1 goto failed
)

rmdir /s /q "%TEMP_DIR%" 2>nul
echo.
echo Installed. WARNO itself is not changed yet.
echo.
:: Anything but Y leaves WARNO alone, including a run with no console to read from.
"%SystemRoot%\System32\choice.exe" /C YN /N /M "Apply it to WARNO now? [Y/N] "
if errorlevel 2 goto not_applied
if not errorlevel 1 goto not_applied

:: --ymb-path is explicit because this file runs from the mod root, and older YMB
:: releases resolve their builder root from the working directory.
call "%YMB_DIR%\YMB.bat" sync %MOD_ARGS% --yes --ymb-path "%YMB_DIR%" || goto sync_failed
echo.
echo Applied. Undo it any time from this folder:
echo   YMB\YMB.bat recover %MOD_ARGS% --yes
echo.
if not defined CI pause
endlocal & exit /b 0

:not_applied
echo.
echo Nothing was changed. Apply it later from this folder:
echo   YMB\YMB.bat sync %MOD_ARGS% --yes
echo.
if not defined CI pause
endlocal & exit /b 0

:sync_failed
echo.
echo Sync stopped. If WARNO looks wrong, run this from this folder:
echo   YMB\YMB.bat recover %MOD_ARGS% --yes
echo.
if not defined CI pause
endlocal & exit /b 1

:failed
rmdir /s /q "%TEMP_DIR%" 2>nul
echo.
echo Stopped. Nothing in WARNO was changed.
if not defined CI pause
endlocal & exit /b 1

:check_placement
:: `%%~nxI` reads the literal token, so the parent is resolved to a full path first.
for %%I in ("%MOD_ROOT%\..") do set "MODS_DIR=%%~fI"
for %%I in ("%MODS_DIR%") do if /I not "%%~nxI"=="Mods" goto bad_placement
if not exist "%MOD_ROOT%\CommonData\" goto bad_placement
if not exist "%MOD_ROOT%\GameData\" goto bad_placement
if exist "%YMB_DIR%\.git" (
  echo [ERROR] "%YMB_DIR%" is a Git checkout, not a portable install. Move it aside first.
  exit /b 1
)
exit /b 0

:bad_placement
echo [ERROR] Put this file in a WARNO mod folder, beside CommonData and GameData.
echo         Create one with: Mods\CreateNewMod.bat YourModName
exit /b 1

:check_tools
:: Full paths on purpose: Git for Windows, MSYS, and Cygwin all put a Unix `tar` on
:: PATH that reads "C:\..." as a remote host and fails, and PATH order is the
:: user's, not ours. PATH is only a fallback for a system without System32 copies.
set "TAR_EXE=%SystemRoot%\System32\tar.exe"
if not exist "%TAR_EXE%" for %%T in (tar.exe) do set "TAR_EXE=%%~$PATH:T"
set "ROBOCOPY_EXE=%SystemRoot%\System32\robocopy.exe"
if not exist "%ROBOCOPY_EXE%" for %%T in (robocopy.exe) do set "ROBOCOPY_EXE=%%~$PATH:T"
if exist "%TAR_EXE%" if exist "%ROBOCOPY_EXE%" exit /b 0
echo [ERROR] Windows tar.exe or robocopy.exe is missing. Install current Windows updates.
exit /b 1

:install_ymb
echo Downloading YMB...
mkdir "%TEMP_DIR%\ymb" 2>nul
for /f "usebackq delims=" %%U in (`powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $h=@{Accept='application/vnd.github+json'; 'User-Agent'='YMB-Auto-Deploy'}; $r=Invoke-RestMethod -UseBasicParsing -Headers $h -Uri ('https://api.github.com/repos/' + $env:REPO_OWNER + '/YMB/releases/latest'); ($r.assets | Where-Object { $_.name -match '^YMB-v.+-windows-x64\.zip$' } | Select-Object -First 1).browser_download_url"`) do set "YMB_URL=%%U"
if not defined YMB_URL (
  echo [ERROR] No Windows YMB archive in the latest release.
  exit /b 1
)
call :download "%YMB_URL%" "%TEMP_DIR%\ymb.zip" || exit /b 1
"%TAR_EXE%" -xf "%TEMP_DIR%\ymb.zip" -C "%TEMP_DIR%\ymb" || exit /b 1
if not exist "%TEMP_DIR%\ymb\YMB\runtime\bun.exe" (
  echo [ERROR] The YMB release is missing its runtime.
  exit /b 1
)
"%TEMP_DIR%\ymb\YMB\runtime\bun.exe" --version >nul || exit /b 1

if exist "%YMB_DIR%\" if not exist "%YMB_DIR%\YMB.bat" (
  echo [ERROR] "%YMB_DIR%" exists but is not a YMB install. Move it aside first.
  exit /b 1
)
if exist "%YMB_DIR%\ymb.config.yaml" (
  copy /y "%YMB_DIR%\ymb.config.yaml" "%TEMP_DIR%\ymb\YMB\ymb.config.yaml" >nul || exit /b 1
)
for %%D in (app docs runtime types) do (
  call :replace_directory "%TEMP_DIR%\ymb\YMB\%%D" "%YMB_DIR%\%%D"
  if errorlevel 1 exit /b 1
)
call :mirror "%TEMP_DIR%\ymb\YMB" "%YMB_DIR%" /LEV:1 || exit /b 1
call :mirror "%TEMP_DIR%\ymb\YMB\mods" "%YMB_DIR%\mods" /LEV:1 || exit /b 1
"%YMB_DIR%\runtime\bun.exe" --version >nul || (
  echo [ERROR] The installed YMB runtime does not start.
  exit /b 1
)
exit /b 0

:: Installs one mod from its published configuration package - the `config` folder
:: YMB builds from, plus that repository's legal text. No Git, no full source tree.
:install_mod
echo Installing %1...
mkdir "%TEMP_DIR%\%1" 2>nul
call :download "https://github.com/%REPO_OWNER%/%1/releases/download/stable/%1-config.zip" "%TEMP_DIR%\%1.zip" || exit /b 1
"%TAR_EXE%" -xf "%TEMP_DIR%\%1.zip" -C "%TEMP_DIR%\%1" || exit /b 1
if not exist "%TEMP_DIR%\%1\%1\config\ymb.mod.yaml" (
  echo [ERROR] The %1 package has an unexpected layout.
  exit /b 1
)
if exist "%YMB_DIR%\mods\%1\.git" (
  echo [ERROR] "%YMB_DIR%\mods\%1" is a Git checkout. Move it aside first.
  exit /b 1
)
set "MOD_INSTALL_ROOT=%YMB_DIR%\mods\%1"
call :mirror "%TEMP_DIR%\%1\%1" "%MOD_INSTALL_ROOT%" /LEV:1 || exit /b 1
:: Saved decks refer to these identities. An update must not reset them.
call :replace_directory "%TEMP_DIR%\%1\%1\config" "%MOD_INSTALL_ROOT%\config" "*.store.json"
exit /b

:replace_directory
set "DIRECTORY_TARGET=%~2"
set "DIRECTORY_STAGE=%~2.ymb-new-%RANDOM%-%RANDOM%"
set "DIRECTORY_BEFORE=%~2.ymb-old-%RANDOM%-%RANDOM%"
if exist "%DIRECTORY_STAGE%" exit /b 1
if exist "%DIRECTORY_BEFORE%" exit /b 1
mkdir "%DIRECTORY_STAGE%" || exit /b 1
call :mirror "%~1" "%DIRECTORY_STAGE%" || goto directory_stage_failed
if not "%~3"=="" if exist "%DIRECTORY_TARGET%\" (
  call :mirror "%DIRECTORY_TARGET%" "%DIRECTORY_STAGE%" %3
  if errorlevel 1 goto directory_stage_failed
)
if exist "%DIRECTORY_TARGET%\" (
  move "%DIRECTORY_TARGET%" "%DIRECTORY_BEFORE%" >nul
  if errorlevel 1 goto directory_stage_failed
)
move "%DIRECTORY_STAGE%" "%DIRECTORY_TARGET%" >nul
if errorlevel 1 goto directory_swap_failed
if exist "%DIRECTORY_BEFORE%\" rmdir /s /q "%DIRECTORY_BEFORE%"
exit /b 0

:directory_swap_failed
if exist "%DIRECTORY_BEFORE%\" (
  move "%DIRECTORY_BEFORE%" "%DIRECTORY_TARGET%" >nul
  if errorlevel 1 echo [ERROR] Restore the previous directory from "%DIRECTORY_BEFORE%".
)
:directory_stage_failed
if exist "%DIRECTORY_STAGE%\" rmdir /s /q "%DIRECTORY_STAGE%"
echo [ERROR] Could not update "%DIRECTORY_TARGET%". The previous directory was kept.
exit /b 1

:download
set "DOWNLOAD_URL=%~1"
set "DOWNLOAD_TARGET=%~2"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:DOWNLOAD_URL -OutFile $env:DOWNLOAD_TARGET"
exit /b

:mirror
:: Robocopy reports success as exit codes 0-7, so it is normalized to 0 here.
"%ROBOCOPY_EXE%" "%~1" "%~2" %3 %4 /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if %ERRORLEVEL% GEQ 8 (
  echo [ERROR] Could not copy files into "%~2".
  exit /b 1
)
exit /b 0
