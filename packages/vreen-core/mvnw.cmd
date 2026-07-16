@echo off
rem vreen-core Maven wrapper (Windows).
rem Downloads Apache Maven 3.9.16 on first run to .mvn\wrapper\maven-dist,
rem then invokes mvn with the requested args.
setlocal
set HERE=%~dp0
set DIST=%HERE%.mvn\wrapper\maven-dist
set MAVEN_VERSION=3.9.16
if exist "%DIST%\apache-maven-%MAVEN_VERSION%\bin\mvn.cmd" goto run
echo Downloading Apache Maven %MAVEN_VERSION%...
if not exist "%DIST%" mkdir "%DIST%"
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'https://dlcdn.apache.org/maven/maven-3/%MAVEN_VERSION%/binaries/apache-maven-%MAVEN_VERSION%-bin.zip' -OutFile '%DIST%\maven.zip' } catch { exit 1 }"
if errorlevel 1 (
  echo Download failed. Please install Maven manually or pre-populate %DIST%.
  exit /b 1
)
powershell -NoProfile -Command "Expand-Archive -Path '%DIST%\maven.zip' -DestinationPath '%DIST%' -Force"
del "%DIST%\maven.zip"
:run
call "%DIST%\apache-maven-%MAVEN_VERSION%\bin\mvn.cmd" %*
endlocal & exit /b %ERRORLEVEL%
