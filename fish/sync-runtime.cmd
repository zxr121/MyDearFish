@echo off
setlocal
chcp 65001 >nul
set "PATH=%~dp0..\..\tools\npm-global;%~dp0..\..\tools\node;%PATH%"
set "NODE=node"
if exist "%~dp0..\..\tools\node\node.exe" set "NODE=%~dp0..\..\tools\node\node.exe"
"%NODE%" "%~dp0sync-runtime.mjs" %*
exit /b %ERRORLEVEL%
