@echo off
:: Redirects to the maintained root installer.
:: Old documentation may point here — this wrapper ensures it still works.
cd /d "%~dp0\.."
call install.bat %*
