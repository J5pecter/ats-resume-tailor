@echo off
REM Launches the dev server with Node on PATH.
REM Needed because the editor process was started before Node was installed and
REM therefore inherited a PATH without it.
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0.."
call npm run dev
