# Running Piazza HQ in a container

This image is the **server** — `server.js`, headless. The wall display is a
separate browser (a TV, a wall tablet, a mini-PC in kiosk mode) pointed at
this container's `http://<host>:3000/`. Same split as a Pi; the server just
happens to be a container instead.

## Quick start

```bash
mkdir piazzahq && cd piazzahq
curl -O https://raw.githubusercontent.com/jlauty21/PiazzaHQ/main/docker-compose.yml
docker compose up -d
```

Then:

- **Control app / setup:** `http://<this-host>:3000/app`
- **The display (point your TV/tablet here):** `http://<this-host>:3000/`

`docker compose` creates a named volume `piazzahq-data` mounted at `/data`
holding everything that must persist: `calendar.db`, uploaded photos, the
session secret, and this instance's device id.

## Or plain `docker run`

```bash
docker run -d --name piazzahq \
  -p 3000:3000 \
  -v piazzahq-data:/data \
  -e TZ=America/Chicago \
  --restart unless-stopped \
  ghcr.io/jlauty21/piazzahq:latest
```

## Updating

```bash
docker compose pull && docker compose up -d
```

The in-app "Software Update" is **disabled in a container** — the code lives
on a read-only image layer, so updating means pulling a newer image. The app
still checks for new versions and shows which one is available; it just
won't try to swap files on disk. Your data in `/data` is untouched by an
image update.

## LAN devices, Home Assistant, Tailscale

By default the container uses **bridge networking**. That's fine for:

- public calendar feeds (Google, iCloud, Outlook shared links)
- weather, news, stocks, sports
- update checks / the licence check-in

It is **not** enough for anything that has to reach your local network
directly:

- **Discovering devices on your LAN** (the Home Assistant auto-detect scans
  the *container's* subnet, not your real LAN)
- **Home Assistant by hostname** — `homeassistant.local` (mDNS) doesn't
  resolve across the bridge; use HA's IP address instead, or host networking
- **Tailscale** — there's no `tailscale` binary in the image, so remote
  access, the Tailscale "Add a Display" URLs, and HA-over-Tailscale
  discovery are unavailable unless the host provides it

For those, switch the container to **host networking** — in
`docker-compose.yml`, remove the `ports:` block and add:

```yaml
    network_mode: host
```

Now the app is on the host's `:3000` directly and can see the host's LAN and
`homeassistant.local`. Tailscale still needs to be running on the host
itself.

## Backups

Two independent things:

- **`docker cp` / volume backup of `/data`** — the whole dataset. Do this
  before a risky change.
- **Settings → Advanced → "Download full backup"** — a `.zip` of
  `calendar.db` + photos, works normally inside the container.

## TV power control

Roku and Samsung TV control (network-based) work. HDMI-CEC and the
Pi/`xrandr` methods do not — there's no `cec-client`/`xrandr` in the image,
and those drivers report a clear error rather than crashing.

## Image tags / channels

- `ghcr.io/jlauty21/piazzahq:latest` — the current **stable** (the default;
  what you want unless you're testing)
- `ghcr.io/jlauty21/piazzahq:beta` — the current **beta**
- `ghcr.io/jlauty21/piazzahq:1.83.4` / `:1.83.4-beta.7` — a specific version

To run betas, change the `image:` line in `docker-compose.yml` to `:beta`,
then `docker compose pull && docker compose up -d`. Switch back to `:latest`
the same way. Same opt-in channel model as a Pi beta tester.

Images publish automatically when a release goes out on the corresponding
channel.
