@echo off
rem Script di installazione di Mark per Windows

echo Creazione directory di installazione...
if not exist "%LOCALAPPDATA%\Programs\Mark" mkdir "%LOCALAPPDATA%\Programs\Mark"

echo Esecuzione della build...
call npm install
call npm run build

echo Verifica dell'esecuzione della build...
if not exist "dist\win-unpacked\Mark.exe" (
    echo Errore: file eseguibile non trovato in dist\win-unpacked\Mark.exe
    exit /b 1
)

echo Copia dell'applicazione nella directory di installazione...
xcopy /s /y "dist\win-unpacked\*" "%LOCALAPPDATA%\Programs\Mark\"

echo Verifica che l'applicazione sia stata copiata correttamente...
if not exist "%LOCALAPPDATA%\Programs\Mark\Mark.exe" (
    echo Errore: L'applicazione non è stata copiata correttamente nella directory di installazione.
    exit /b 1
)

echo Creazione del collegamento sul desktop...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Mark.lnk'); $s.TargetPath = '%LOCALAPPDATA%\Programs\Mark\Mark.exe'; $s.Save()"

echo Creazione del collegamento nel menu Start...
if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs" mkdir "%APPDATA%\Microsoft\Windows\Start Menu\Programs"
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('StartMenu') + '\Programs\Mark.lnk'); $s.TargetPath = '%LOCALAPPDATA%\Programs\Mark\Mark.exe'; $s.Save()"

echo Associazione dell'estensione .md a Mark...
reg add "HKCU\Software\Classes\.md" /ve /d "MarkdownFile" /f
reg add "HKCU\Software\Classes\MarkdownFile" /ve /d "File Markdown" /f
reg add "HKCU\Software\Classes\MarkdownFile\DefaultIcon" /ve /d "%LOCALAPPDATA%\Programs\Mark\Mark.exe,0" /f
reg add "HKCU\Software\Classes\MarkdownFile\shell\open\command" /ve /d "\"%LOCALAPPDATA%\Programs\Mark\Mark.exe\" \"%%1\"" /f

echo Mark è stato installato correttamente.
echo Per eseguire Mark, cerca "Mark" nel menu Start o usa il collegamento sul desktop.
pause