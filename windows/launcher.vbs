' Piazza HQ — Windows launcher
' -----------------------------
' Run from the Desktop shortcut (and, in wall-display mode, from a Startup
' shortcut at sign-in). Does two things:
'   1. Starts the bundled node.exe running server.js, hidden (no console
'      window) and NOT waiting for it to exit, unless it's already running.
'   2. Opens the app.
'
' First argument selects how step 2 opens:
'   "app"    (default) — open http://localhost:PORT/app in the default
'                        browser, a normal window. The control app.
'   "kiosk"           — open http://localhost:PORT/ full-screen with no
'                        browser chrome, in an isolated Chrome/Edge profile.
'                        The wall display. Falls back to the default browser
'                        (windowed) if no Chromium-family browser is found.
'
' Deliberately VBScript, not a .bat: a .bat launching "node.exe server.js"
' directly leaves a visible console window open for as long as the server
' runs. WScript.Shell.Run window-style 0 (hidden) solves that with no extra
' packaged tool.
'
' Set PIAZZA_LAUNCHER_DRYRUN=1 in the environment to print what would be run
' instead of running it (used by the build's launcher test).
'
' Port must match server.js's own default (see `const PORT` near the top of
' server.js) — if that ever changes, update PORT below to match.
Const PORT = 3000

Dim shell, fso, appDir, nodePath, serverScript, baseUrl, mode, dryRun
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseUrl = "http://localhost:" & PORT & "/"

mode = "app"
If WScript.Arguments.Count >= 1 Then mode = LCase(Trim(WScript.Arguments(0)))
If mode <> "kiosk" And mode <> "app" Then mode = "app"

dryRun = (shell.ExpandEnvironmentStrings("%PIAZZA_LAUNCHER_DRYRUN%") = "1")

' %~dp0 equivalent for VBScript — the folder this script itself lives in,
' so this works regardless of where Inno Setup actually installs to.
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodePath = appDir & "\node\node.exe"
serverScript = appDir & "\app\server.js"

Function ServerIsUp()
  Dim http
  On Error Resume Next
  Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
  http.SetTimeouts 500, 500, 500, 500 ' ms — this only needs to be fast, not thorough
  http.Open "GET", baseUrl, False
  http.Send
  ServerIsUp = (Err.Number = 0)
  On Error Goto 0
End Function

' Returns the full path to a Chromium-family browser for kiosk mode, or ""
' if none is found. Prefers Chrome, then Edge (which is present on every
' current Windows install, so this rarely returns "").
Function FindKioskBrowser()
  Dim candidates, i, p
  candidates = Array( _
    shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
    shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe", _
    shell.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe", _
    shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
    shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe" )
  FindKioskBrowser = ""
  For i = 0 To UBound(candidates)
    p = candidates(i)
    If fso.FileExists(p) Then
      FindKioskBrowser = p
      Exit Function
    End If
  Next
End Function

' ── 1. Make sure the server is running ──────────────────────────────────────
If Not ServerIsUp() Then
  If Not fso.FileExists(nodePath) Then
    MsgBox "Couldn't find node.exe at:" & vbCrLf & nodePath & vbCrLf & vbCrLf & _
      "The install may be incomplete or moved. Try reinstalling Piazza HQ.", vbExclamation, "Piazza HQ"
    WScript.Quit 1
  End If
  Dim startCmd
  startCmd = """" & nodePath & """ """ & serverScript & """"
  If dryRun Then
    WScript.Echo "would start server (hidden): " & startCmd
  Else
    ' 0 = hidden window, False = don't wait for it to exit (long-running server).
    shell.Run startCmd, 0, False
  End If

  ' Poll for readiness rather than a blind sleep — a slower machine shouldn't
  ' get a "connection refused" tab just because it took a couple extra
  ' seconds to start. Gives up after ~15s and opens the app anyway; if the
  ' server's just slow the browser's own retry/reload covers it.
  Dim waited, up
  waited = 0
  up = False
  Do While waited < 15000 And Not up
    If dryRun Then Exit Do
    WScript.Sleep 500
    waited = waited + 500
    up = ServerIsUp()
  Loop
End If

' ── 2. Open the app ────────────────────────────────────────────────────────
Dim targetUrl, browser, kioskCmd
If mode = "kiosk" Then
  ' "/" — the wall display. ?kiosk=1 tells display.html it's the Windows
  ' full-screen kiosk, which reveals a tap-to-exit control (see
  ' KIOSK_EXIT / POST /api/kiosk/exit).
  targetUrl = baseUrl & "?kiosk=1"
  browser = FindKioskBrowser()
  If browser <> "" Then
    kioskCmd = """" & browser & """ --kiosk --app=" & targetUrl & _
      " --user-data-dir=""" & appDir & "\kiosk-profile""" & _
      " --no-first-run --no-default-browser-check --disable-session-crashed-bubble" & _
      " --disable-infobars --overscroll-history-navigation=0"
    If dryRun Then
      WScript.Echo "mode=kiosk"
      WScript.Echo "would launch: " & kioskCmd
    Else
      shell.Run kioskCmd, 1, False
    End If
  Else
    ' No Chromium-family browser — best effort: default browser, windowed.
    If dryRun Then
      WScript.Echo "mode=kiosk (no chromium browser found)"
      WScript.Echo "would open (default browser): " & targetUrl
    Else
      shell.Run targetUrl
    End If
  End If
Else
  targetUrl = baseUrl & "app"               ' "/app" — the control app
  If dryRun Then
    WScript.Echo "mode=app"
    WScript.Echo "would open (default browser): " & targetUrl
  Else
    shell.Run targetUrl
  End If
End If
