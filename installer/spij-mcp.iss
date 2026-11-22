#ifndef AppVersion
  #define AppVersion "0.3.0"
#endif
#ifndef StageDir
  #define StageDir "..\dist\win-stage"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

[Setup]
AppId={{7B6F4C1E-9C84-4C3B-8F14-7D8F1E2A9B10}
AppName=SPIJ MCP
AppVersion={#AppVersion}
AppPublisher=Dario Morales
AppPublisherURL=https://dariomorales.com/es/spij/
AppSupportURL=https://github.com/dariodemh/spijmcp
AppUpdatesURL=https://github.com/dariodemh/spijmcp/releases/latest
DefaultDirName={localappdata}\Programs\SPIJ-MCP
DefaultGroupName=SPIJ MCP
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=SPIJ-MCP-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\SPIJ-MCP.exe
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
AppMutex=Local\SPIJ-MCP-SingleInstance
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el Escritorio"; GroupDescription: "Accesos directos:"
Name: "autostart"; Description: "Iniciar SPIJ MCP automáticamente al encender Windows (recomendado)"; GroupDescription: "Inicio automático:"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\SPIJ MCP"; Filename: "{app}\SPIJ-MCP.exe"; IconFilename: "{app}\SPIJ-MCP.exe"
Name: "{group}\Desinstalar SPIJ MCP"; Filename: "{uninstallexe}"
Name: "{autodesktop}\SPIJ MCP"; Filename: "{app}\SPIJ-MCP.exe"; IconFilename: "{app}\SPIJ-MCP.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "SPIJ-MCP"; ValueData: """{app}\SPIJ-MCP.exe"" --minimized"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\SPIJ-MCP.exe"; Description: "Abrir SPIJ MCP ahora"; Flags: nowait postinstall skipifsilent
