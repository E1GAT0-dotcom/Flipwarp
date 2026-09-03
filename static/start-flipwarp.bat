@echo off
title Flipwarp
cd /d "%~dp0"
set PORT=8601
set URL=http://localhost:%PORT%/editor.html

echo Starting Flipwarp...
echo.
echo Leave this black window open while you use the editor.
echo Closing it stops Flipwarp.
echo.

rem Open in Chrome if it is installed, rather than whichever browser Windows
rem happens to treat as the default. Handing the address to chrome.exe while
rem Chrome is already running opens a tab in the window that is already there.
set CHROME=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe

where py >nul 2>nul
if %errorlevel%==0 goto usepy

where python >nul 2>nul
if %errorlevel%==0 goto usepython

where node >nul 2>nul
if %errorlevel%==0 goto usenode

echo Flipwarp needs a small web server to run from a folder, because a
echo browser will not let a page opened straight off your disk read the
echo files next to it.
echo.
echo Neither Python nor Node was found on this computer. Install Python
echo from https://python.org and tick "Add python.exe to PATH" during
echo setup, then run this file again.
echo.
pause
goto :eof

:usepy
call :openbrowser
py -m http.server %PORT%
goto :eof

:usepython
call :openbrowser
python -m http.server %PORT%
goto :eof

:usenode
call :openbrowser
npx --yes http-server -p %PORT%
goto :eof

:openbrowser
if defined CHROME goto chromestart
echo Chrome was not found, so this will open in your default browser.
start "" "%URL%"
goto :eof
:chromestart
start "" "%CHROME%" "%URL%"
goto :eof
