# Remote Access Setup

This guide covers two steps:
1. Setting a PIN on your control app
2. Exposing it to the internet via Cloudflare Tunnel (free)

---

## Step 1 — Set Your PIN

Before exposing the app publicly, set a PIN:

1. Open the control app: `http://<pi-ip>:3000/app`
2. Go to **Settings** tab
3. Enter a PIN under **Security** and tap **Save Settings**
4. You'll be prompted for the PIN on any new device or browser

The display page (`/`) is always public — only the control app (`/app`) and API write endpoints are protected.

---

## Step 2 — Cloudflare Tunnel

Cloudflare Tunnel creates a secure public URL pointing to your Pi — no port forwarding, no static IP, no router changes needed. It's free.

### Install cloudflared on your Pi

```bash
# Download the ARM64 binary (use armhf for older Pi models)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Verify
cloudflared --version
```

> For Pi 3 or earlier (32-bit), use `cloudflared-linux-armhf` instead of `arm64`.

### Option A — Quick test (temporary URL, no account needed)

```bash
cloudflared tunnel --url http://localhost:3000
```

You'll see a line like:
```
Your quick Tunnel has been created! Visit it at:
https://random-words-here.trycloudflare.com
```

That URL is live immediately. It goes away when you stop the command. Good for testing.

### Option B — Permanent URL (free Cloudflare account required)

This gives you a stable URL that survives reboots.

#### 1. Create a free Cloudflare account
Go to [cloudflare.com](https://cloudflare.com) and sign up.

#### 2. Authenticate cloudflared
```bash
cloudflared tunnel login
```
This opens a browser window. Log in and authorize.

#### 3. Create a named tunnel
```bash
cloudflared tunnel create piazzahq
```
Note the tunnel ID printed — you'll need it.

#### 4. Create the config file
```bash
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

Paste this (replace `YOUR_TUNNEL_ID`):
```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /home/pi/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: calendar.yourdomain.com   # or use a free subdomain (see below)
    service: http://localhost:3000
  - service: http_status:404
```

#### 5. Optional — use a free subdomain without a custom domain
If you don't have a domain, use a `trycloudflare.com` subdomain permanently:
```bash
cloudflared tunnel route dns piazzahq calendar   # creates calendar.trycloudflare.com
```

#### 6. Run the tunnel
```bash
cloudflared tunnel run piazzahq
```

#### 7. Auto-start on boot (systemd)
```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

---

## Your setup when done

| URL | What it does |
|-----|-------------|
| `https://your-url.trycloudflare.com/` | Display (public, no PIN) |
| `https://your-url.trycloudflare.com/app` | Control app (PIN protected) |

Bookmark `/app` on your iPhone's home screen (Safari → Share → Add to Home Screen)
and you have a PIN-protected calendar app you can use anywhere in the world.

---

## Security notes

- The display page (`/`) is intentionally public — it only shows calendar data, not your PIN or settings
- All API write operations (adding events, changing settings, uploading photos) require the PIN
- Cloudflare handles HTTPS automatically — the connection is encrypted end-to-end
- If you ever want to revoke access, change the PIN in Settings or run `cloudflared tunnel delete piazzahq`
