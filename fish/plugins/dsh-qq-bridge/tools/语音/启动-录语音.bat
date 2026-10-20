@echo off
chcp 65001 >nul
title 录语音（发到 QQ）
cd /d "%~dp0"

echo ============================================================
echo   把 AI 在 DSH 里"念出来"的语音，录下来发到 QQ
echo ============================================================
echo.
echo   两种发法，自己选：
echo     1 = 切断发 —— 边录边发，念一段发一段（响应快，但会连着好几条）
echo     2 = 完整发 —— 整段念完，合成一条再发（干净，但要等念完）
echo.
set /p 模式=请输入 1 或 2（直接回车 = 1）：

if "%模式%"=="" set 模式=1
if not "%模式%"=="1" if not "%模式%"=="2" (
  echo 只能输 1 或 2，退出。
  pause
  exit /b 1
)

echo.
echo 【必填】语音发给哪个 QQ 号？（数字）
set /p 目标QQ=

if "%目标QQ%"=="" (
  echo 没填 QQ 号：这次只录音、不发送（录好的文件在 桌面\AI语音 里）。
)

echo.
echo 正在启动……（关掉这个黑窗口 = 停止）
echo.

set QQ_VOICE_TARGET=%目标QQ%
node "录语音.mjs" %模式%

echo.
echo 已退出。
pause
