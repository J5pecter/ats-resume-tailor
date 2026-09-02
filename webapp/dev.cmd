@echo off
REM Runs the Python web app for development. Reload on, SQLite by default, so a
REM fresh checkout needs no configuration at all.
cd /d "%~dp0"
if not defined SECRET_KEY set SECRET_KEY=dev-only-secret-key-not-for-deployment
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
