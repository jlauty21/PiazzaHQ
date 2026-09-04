# Building the Windows installer

Everything in this folder is ready except two things this environment
genuinely can't produce — no Windows machine to run on, and no network
access to nodejs.org from this sandbox. Both are quick on your end.

## 1. Get the portable Node.js runtime

1. On a Windows machine, go to https://nodejs.org/en/download
2. Download the **Windows Binary (.zip)**, 64-bit — NOT the `.msi`
   installer (that installs Node system-wide with its own setup wizard,
   which is exactly what bundling is meant to avoid). Match whatever Node
   major version the app's already tested against (check `.nvmrc` or just
   use the current LTS if there's no pinned version).
3. Extract the zip. Inside, you'll find `node.exe` sitting alongside a
   `node_modules\npm\` folder — that whole extracted folder's *contents*
   (not the folder itself nested one level down) need to end up at:

   ```
   windows\build-input\node\node.exe
   windows\build-input\node\npm.cmd
   windows\build-input\node\...
   ```

   i.e. `node.exe` should be directly inside `build-input\node\`, not
   inside a `build-input\node\node-v20.x.x-win-x64\` subfolder.

## 2. Install real dependencies (must run ON Windows)

`better-sqlite3` has a native binary component — running `npm install`
anywhere other than the actual target OS fetches/builds the wrong binary,
so this step genuinely has to happen on Windows itself, not in this
sandbox.

```
cd windows\build-input\app
npm install --omit=dev
```

This is the one step that needs internet access at build time (fetching
packages from the npm registry). Once it's done, `node_modules` is just
files — the installer that ships to end users has no further internet
dependency to run.

## 3. Install Inno Setup

Download and install from https://jrsoftware.org/isinfo.php (free). This
gives you the Inno Setup Compiler (`ISCC.exe`) and the Inno Setup IDE.

The app icon (`windows\piazzahq.ico`) is committed — it's the brass calendar
mark from `public\assets\favicon.svg`. Regenerate it only if that logo
changes: render the SVG to PNGs at 16/24/32/48/64/128/256 (headless Chrome
`--headless=new --default-background-color=00000000` gives real
transparency) and pack them into a multi-size `.ico`.

## 4. Compile

Either:
- Open `windows\piazzahq.iss` in the Inno Setup IDE and press **Compile**
  (Ctrl+F9), or
- From a command prompt: `ISCC.exe windows\piazzahq.iss`

Output lands in `windows\Output\PiazzaHQ-Setup-<version>.exe` (the version
comes from `MyAppVersion` in `piazzahq.iss` — keep it in step with
`build-input\app\package.json`). This is the actual installer to run and see
the real first-run experience (SmartScreen block included, since this build
is deliberately unsigned).

## What you're about to see, so it's not a surprise

- Running the compiled `.exe` will very likely trigger the full-screen blue
  "Windows protected your PC" SmartScreen warning — expected, this build
  is unsigned on purpose so you can experience that firsthand. "More info"
  → "Run anyway" gets past it.
- The install wizard itself should be a normal, uneventful Next → Next →
  Install → Finish — no admin/UAC prompt, since this installs to
  `%LocalAppData%`, not Program Files.
- First time the server actually starts (via the Desktop shortcut, or the
  "Launch now" checkbox at the end of setup), expect a Windows Defender
  Firewall prompt asking to allow the app on private/public networks —
  this is unrelated to signing or the installer and happens for any app
  that opens a listening network port.
- After that first run, it should just be: double-click shortcut → browser
  tab opens to the calendar → done.

## Self-update on Windows (added in 1.83.3-beta.3)

The device self-update flow now works on Windows. `server.js` branches on
`process.platform === 'win32'`:
- zip extraction uses `%SystemRoot%\System32\tar.exe` (bsdtar) instead of the
  `unzip` binary;
- there's no systemd, so after a code swap the process supervises its own
  handoff — spawns the replacement, watches it come up healthy on the new
  version, and **auto-restores the pre-update backup and relaunches** if it
  doesn't;
- the post-swap `npm install` is skipped (the build already ships a complete
  `node_modules`, and there's no compiler on the target machine anyway).

Net effect: an installed Windows copy pulls and applies releases from the
mothership the same way a Pi does. Test it after installing (see
`BETA_CHECKLIST.md`).

## Known gaps still open

- `tv-control.js` ships as-is; its CEC/HDMI-cut drivers are Linux-only and
  will just fail with a clear error if anyone tries to use TV power control
  from Windows. Not disabled, just non-functional there for now.
- Server-side zip *creation* still shells out to the `zip` binary
  (`buildBackupZip()`, `buildSelfUpdateZip()`, the backup-download route), so
  "Download full backup" and host→slave push updates don't work from a
  Windows host yet. A `tar.exe -a -cf` branch (mirroring the extraction one)
  would close this.
- `MyAppVersion` in `piazzahq.iss` still has to be bumped by hand to match
  `build-input\app\package.json` — there's no build step that syncs them.
