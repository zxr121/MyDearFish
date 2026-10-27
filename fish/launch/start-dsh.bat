@echo off
chcp 65001 >nul
title Start DSH Companion
"C:\DWDevEnvironment\node-v24.16.0-win-x64\node.exe" "%~dp0launch-all.mjs"
if /I "%~1"=="--auto" exit /b
echo.
pause >nul
