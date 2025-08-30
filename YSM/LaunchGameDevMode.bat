@echo off
set GAME_NAME=WARNO

for %%* in (.) do set CurrDirName=%%~nx*
..\..\%GAME_NAME%.exe -activatemods "%CurrDirName%" -devmode
