@echo off
rem auto-check: scheduled run of one check, written by auto-check schedule install.
rem Only a schedule calls this file, so it runs auto-check run --scheduled. Arguments
rem given to it, such as --phase start, pass through.
setlocal
cd /d "{{root}}" || exit /b 2
if not exist "logs" mkdir "logs"
>> "logs\schedule.log" echo [%date% %time%] start %*
"{{node}}" "{{tool}}" run "{{root}}" --scheduled %* < NUL >> "logs\schedule.log" 2>&1
set "code=%errorlevel%"
>> "logs\schedule.log" echo [%date% %time%] exit %code%
exit /b %code%
