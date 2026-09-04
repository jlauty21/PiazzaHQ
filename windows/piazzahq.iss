; Piazza HQ — Windows installer (Inno Setup script)
; ---------------------------------------------------
; Unsigned, Node.js bundled (no separate Node install step for the end
; user). One wizard choice ([Tasks] below): "control device" (default) — a
; Desktop shortcut that opens /app in the default browser — or "wall
; display" — a full-screen kiosk browser plus a sign-in Startup entry.
; Either way the bundled node.exe runs server.js hidden, and self-update
; works (see server.js's IS_WIN branches and BUILD.md).
;
; This file only compiles once TWO things exist alongside it, neither of
; which this environment could produce (see BUILD.md for exactly how to
; get them):
;   1. build-input\app\   — already staged with the real app source
;      (server.js, templates.js, tv-control.js, package.json, public\,
;      LICENSE), MINUS node_modules — that has to be produced by running
;      `npm install --omit=dev` ON AN ACTUAL WINDOWS MACHINE, not here,
;      because better-sqlite3 has a native binary component and needs to
;      fetch/build the Windows-specific one, not whatever this Linux
;      sandbox would fetch for itself.
;   2. build-input\node\  — NOT staged yet. Download the official
;      "node-vX.Y.Z-win-x64" zip from nodejs.org, extract it, and place
;      its CONTENTS (node.exe should end up directly at
;      build-input\node\node.exe, not one folder deeper) here.
;
; Deliberately installs to {localappdata}, not Program Files — avoids
; requiring admin rights / a UAC prompt during setup itself, which isn't
; needed for a single-user app with no system-wide component. The Windows
; Firewall prompt on first actual run is unrelated to this and can't be
; avoided by an install-location choice.

#define MyAppName "Piazza HQ"
; Keep in step with build-input\app\package.json's "version" — see BUILD.md.
#define MyAppVersion "1.83.3"
#define MyAppPublisher "Piazza HQ"
#define MyAppExeDesc "Piazza HQ — family calendar display"

[Setup]
AppId={{B6E1E7B0-6B6C-4B1B-9B1E-A11ACE000001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\PiazzaHQ
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=PiazzaHQ-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
; No [Icons]-adjacent code-signing step here — this first pass is
; deliberately unsigned; see the conversation this came out of for why.
WizardStyle=modern
DisableWelcomePage=no
; The Piazza HQ brass calendar mark (same logo as piazzahq.com — piazzahq.ico
; is generated from public/assets/favicon.svg, sizes 16-256). Used for the
; Setup .exe itself, the shortcuts (see [Icons]), and Add/Remove Programs.
SetupIconFile=piazzahq.ico
UninstallDisplayIcon={app}\piazzahq.ico
; On an upgrade the server is almost always running, with better_sqlite3.node
; (a native module) mapped into its node.exe — Windows then refuses to let
; Setup replace that file ("DeleteFile failed; code 5"). Let Restart Manager
; try first (the default `.node` isn't in its filter, so add it), and the
; [Code] section below force-stops our own node.exe as the real fix, since a
; hidden wscript-launched console process ignores RM's graceful-close.
; RestartApplications=no — the Startup shortcut / "Launch now" checkbox
; handle relaunching, not Setup.
CloseApplications=yes
CloseApplicationsFilter=*.exe,*.dll,*.chm,*.node
RestartApplications=no

[Tasks]
; Shown on the wizard's "Select Additional Tasks" page. Unchecked (default)
; = "control device": one Desktop shortcut, opens /app in the default
; browser. Checked = "wall display": every shortcut opens / full-screen in
; a kiosk browser, plus a per-user Startup entry so it comes up at sign-in.
Name: "kioskmode"; Description: "Set up this PC as a wall display — full-screen, and starts automatically when you sign in"; GroupDescription: "How will you use Piazza HQ on this PC?"; Flags: unchecked

[Files]
; The app itself — everything EXCEPT node_modules, which must already
; exist inside build-input\app\node_modules by the time this compiles
; (produced by `npm install --omit=dev` on Windows — see BUILD.md).
Source: "build-input\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs ignoreversion
; The bundled, portable Node.js runtime — see the header comment above for
; exactly what needs to be placed here before compiling.
Source: "build-input\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs ignoreversion
; The launcher itself.
Source: "launcher.vbs"; DestDir: "{app}"; Flags: ignoreversion
; The app icon — referenced by every shortcut below and by
; UninstallDisplayIcon above.
Source: "piazzahq.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Desktop shortcut — control-device mode: launcher opens /app, windowed.
Name: "{autodesktop}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\launcher.vbs"" app"; WorkingDir: "{app}"; \
  Comment: "{#MyAppExeDesc}"; IconFilename: "{app}\piazzahq.ico"; Tasks: not kioskmode
; Desktop shortcut — wall-display mode: launcher opens / full-screen (so a
; manual relaunch after Alt+F4'ing out of the kiosk still goes full-screen).
Name: "{autodesktop}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\launcher.vbs"" kiosk"; WorkingDir: "{app}"; \
  Comment: "{#MyAppExeDesc}"; IconFilename: "{app}\piazzahq.ico"; Tasks: kioskmode
; Auto-start at sign-in — wall-display mode only. A Startup-folder shortcut
; (per-user, no elevation, no scheduled-task plumbing). launcher.vbs no-ops
; the server start if it's already running, so this is safe to fire at logon.
Name: "{userstartup}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\launcher.vbs"" kiosk"; WorkingDir: "{app}"; \
  Comment: "{#MyAppExeDesc}"; IconFilename: "{app}\piazzahq.ico"; Tasks: kioskmode
; Start Menu entry — always the control app, regardless of mode.
Name: "{group}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\launcher.vbs"" app"; WorkingDir: "{app}"; \
  Comment: "{#MyAppExeDesc}"; IconFilename: "{app}\piazzahq.ico"

[Run]
; Offer to launch right after install finishes — same launcher, matching the
; chosen mode, not a separate code path to keep in sync.
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"" app"; \
  Description: "Launch {#MyAppName} now"; Flags: nowait postinstall skipifsilent runasoriginaluser; Tasks: not kioskmode
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"" kiosk"; \
  Description: "Launch {#MyAppName} now (full-screen)"; Flags: nowait postinstall skipifsilent runasoriginaluser; Tasks: kioskmode

[UninstallDelete]
; The isolated Chrome/Edge profile the kiosk launcher creates — Inno only
; removes what it installed, so clean this up explicitly. (calendar.db,
; photo uploads and logs\ are deliberately left behind on uninstall.)
Type: filesandordirs; Name: "{app}\kiosk-profile"

[Code]
{ Force-stop any Piazza HQ server running out of the install dir so its
  files (notably the loaded native module node_modules\better-sqlite3\...\
  better_sqlite3.node) can be replaced. Restart Manager can't do this — the
  server is a hidden wscript-launched console node.exe with no window and no
  message loop, so it never answers a graceful close. Targets node.exe by
  executable path so unrelated Node processes on the machine are untouched.
  Runs on both install (PrepareToInstall) and uninstall. }
procedure StopRunningServer(AppDir: String);
var
  PsFile, Ps: String;
  RC: Integer;
begin
  PsFile := ExpandConstant('{tmp}\stop-piazzahq.ps1');
  { CIM Win32_Process exposes ExecutablePath (not .Path — that's Get-Process). }
  Ps :=
    '$dir = ' + AddQuotes(AppDir) + #13#10 +
    'Get-CimInstance Win32_Process -Filter "Name=''node.exe''" |' + #13#10 +
    '  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [System.StringComparison]::OrdinalIgnoreCase) } |' + #13#10 +
    '  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }' + #13#10;
  if SaveStringToFile(PsFile, Ps, False) then
  begin
    Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
         '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + AddQuotes(PsFile),
         '', SW_HIDE, ewWaitUntilTerminated, RC);
    Sleep(1500); { give Windows a moment to release the file handles }
    DeleteFile(PsFile);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  StopRunningServer(ExpandConstant('{app}'));
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningServer(ExpandConstant('{app}'));
  Result := True;
end;
