@echo off
chcp 65001 >nul
title 大肥鱼打版
set "NODE_EXE="
if exist "%~dp0..\..\data\snowluma\node.exe" set "NODE_EXE=%~dp0..\..\data\snowluma\node.exe"
if not defined NODE_EXE if exist "C:\DWDevEnvironment\node-v24.16.0-win-x64\node.exe" set "NODE_EXE=C:\DWDevEnvironment\node-v24.16.0-win-x64\node.exe"
if not defined NODE_EXE set "NODE_EXE=node"
"%NODE_EXE%" "%~dp0release-fish.mjs" %*
echo.
pause
