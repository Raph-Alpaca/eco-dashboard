@echo off
REM Starts a local web server and opens the dashboard.
REM index.html cannot be opened by double-click (ES modules and fetch need http://).
cd /d "%~dp0"
start "" http://localhost:8000/
python -m http.server 8000
