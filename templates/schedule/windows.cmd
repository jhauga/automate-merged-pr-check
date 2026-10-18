@echo off
rem auto-check: scheduled run of one check, written by auto-check schedule install.
rem Arguments given to this file, such as --phase start, pass through to auto-check run.
setlocal
cd /d "{{root}}" || exit /b 2
if not exist "logs" mkdir "logs"
>> "logs\schedule.log" echo [%date% %time%] start %*
"{{node}}" "{{tool}}" run "{{root}}" %* < NUL >> "logs\schedule.log" 2>&1
set "code=%errorlevel%"
>> "logs\schedule.log" echo [%date% %time%] exit %code%
exit /b %code%
