@rem Builds the launcher with the C# compiler of the .NET Framework that comes with Windows, and puts one copy per
@rem shell name into the folder given (default: ..\bin). OpenCode picks the arguments of a shell by its program name.
@rem No command of an agent may be running while the copies are replaced.
@setlocal
@set OUT=%~1
@if "%OUT%"=="" set OUT=%~dp0..\bin
@set CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
@if not exist "%CSC%" (echo csc.exe of the .NET Framework 4 was not found: %CSC% & exit /b 1)
@if not exist "%OUT%" mkdir "%OUT%"
@"%CSC%" -nologo -optimize -out:"%OUT%\launcher.exe" "%~dp0Launcher.cs" "%~dp0Secrets.cs" "%~dp0Guard.cs" || exit /b 1
@for %%n in (bash powershell pwsh cmd protect) do @copy /y "%OUT%\launcher.exe" "%OUT%\%%n.exe" >nul || exit /b 1
@del "%OUT%\launcher.exe"
@echo built into %OUT%
