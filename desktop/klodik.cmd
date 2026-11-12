@echo off
rem Starts Klodik without a console window
start "" powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0klodik.ps1"
