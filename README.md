# Upipination: putting it online from your Linux PC

Commands are for Ubuntu, Debian or Linux Mint. Do the steps in order. Anything inside `< >` is a placeholder.

---

## 0. What's in this folder

| File | What it is |
| --- | --- |
| `server.js` | The server: accounts, chat, posts, events, art, notifications, uploads |
| `setup.js` | Sets the group password. Only a one-way hash is stored |
| `public/` | The page the browser loads |
| `assets/` | Your cat photos for the header (only visible after logging in) |
| `deploy/upipination.service` | Makes the server start on its own |
| `data/` | Created on first run: database, uploads, password hash. **Back this up** |

**No passwords are written in the code.** You choose the group password in step 3, and only its scrypt hash is saved.

---

## 1. Install Node.js 22

The Node.js that comes with Ubuntu is usually too old. Install the current version:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3
node -v        # should print v22.something
```

## 2. Copy the files and install

This creates a locked-down system user that only runs this site. If the site were ever hacked, the attacker couldn't touch the rest of your PC.

```bash
sudo useradd --system --home /opt/upipination --shell /usr/sbin/nologin upipination
sudo mkdir -p /opt/upipination
sudo cp -r ~/Downloads/upipination/. /opt/upipination/     # adjust the path to where you unzipped it
sudo chown -R upipination:upipination /opt/upipination
cd /opt/upipination
sudo -u upipination npm install --omit=dev
```

## 3. Choose the group password

```bash
sudo -u upipination npm run setup
```

* Pick a **new** one, at least 10 characters. A short sentence works well, e.g. `los gatos duermen 14 horas`.
* Don't reuse the password from the design mockups; it has been stored in plain files.
* To change it later, run the same command, then `sudo systemctl restart upipination`. Everyone will need to type the new one.

## 4. Test it on the PC

```bash
sudo -u upipination npm start
```

Open a **web browser on that PC** and go to `http://localhost:3000`. You should see the password screen. Make an account and send a chat message.
Press `Ctrl+C` in the terminal to stop it.

## 5. Make it start on its own

```bash
sudo cp /opt/upipination/deploy/upipination.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now upipination
systemctl status upipination           # should say "active (running)"
journalctl -u upipination -f           # live log (Ctrl+C to exit)
```

Also turn off sleep or suspend in your PC's power settings so it stays on.

---

## 6. Getting your own domain (short note)

A domain is the address people type, like `upipination.com`. It costs about USD 10–15 a year for a `.com`.

* **Easiest:** buy it directly at **Cloudflare** (dash.cloudflare.com → *Domain Registration* → *Register Domains*). It's sold at cost, and it's already set up for step 7.
* **Other shops:** Porkbun or Namecheap. After buying, add the domain to a free Cloudflare account and change the domain's *nameservers* to the two Cloudflare shows you.
* **`.com.ar`:** register it at **nic.ar**. You need a CUIT/CUIL and a Mi Argentina login. It's cheap, and you then point its nameservers to Cloudflare the same way.
* Don't have a domain yet? Cloudflare can give you a temporary random address for testing (Quick Tunnel). It's good enough to try things, but not for everyday use.

## 7. Put it on the internet with Cloudflare Tunnel

The tunnel connects **out** from your PC to Cloudflare. You **don't open any ports on your router**, and your home IP stays hidden. Cloudflare also absorbs floods of traffic (DDoS) and adds HTTPS for free.

1. Go to dash.cloudflare.com → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → *Cloudflared*. Name it `upipination`.
2. Choose **Debian** and copy the commands it shows into your terminal. The last one looks like `sudo cloudflared service install <long-token>`.
3. Under **Public Hostname**, add one:
   * Domain: `upipination.com` (leave the subdomain empty, or use `www`)
   * Service type: **HTTP**, URL: `localhost:3000`
4. Save. After a minute, `https://upipination.com` should load your site.

## 8. Lock it to your domain

```bash
sudo -u upipination cp /opt/upipination/.env.example /opt/upipination/.env
sudo nano /opt/upipination/.env          # put your real domain in PUBLIC_ORIGIN
sudo systemctl restart upipination
```

From now on the server only accepts requests that come from your domain (plus `localhost` for testing).

## 9. Recommended Cloudflare settings (all free)

In the dashboard for your domain:

* **SSL/TLS → Overview:** *Full*
* **SSL/TLS → Edge Certificates:** turn on *Always Use HTTPS*
* **Security → Bots:** turn on *Bot Fight Mode*
* Optional extra lock: **Zero Trust → Access → Applications** can require an email code before anyone even sees the password screen. Add only your friends' emails.

## 10. Firewall on the PC

The site only listens on `127.0.0.1`, so nothing from the network can reach it directly. Still, turn the firewall on:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh        # only if you log in to this PC remotely
sudo ufw enable
```

## 11. Backups

Everything lives in `/opt/upipination/data`. Back it up every night at 4:00 to a folder, ideally on a USB drive:

```bash
sudo apt install -y sqlite3
sudo mkdir -p /backups
sudo crontab -e
```

Add these two lines:

```
0 4 * * * sqlite3 /opt/upipination/data/upipination.db ".backup '/backups/upipination-$(date +\%F).db'"
5 4 * * * rsync -a /opt/upipination/data/uploads/ /backups/uploads/
```

## 12. Keeping it safe over time

Once a month:

```bash
sudo apt update && sudo apt upgrade -y
cd /opt/upipination && sudo -u upipination npm update --omit=dev && sudo -u upipination npm audit
sudo systemctl restart upipination
```

Check for suspicious activity: `journalctl -u upipination | grep security` lists wrong passwords and failed logins with their IPs.

---

## What protects you

* **Passwords:** the group password and user passwords are hashed with scrypt (salted and slow on purpose). They are never stored or logged in plain text.
* **Brute force:** after 5 wrong attempts, that IP or username is locked for 15 minutes. There are also general rate limits on every request and on chat messages.
* **Two locks:** without the group password you can't even reach the sign-up form. Every API call, upload, photo and chat message needs a logged-in session.
* **Sessions:** random 256-bit tokens, stored only as hashes, in `HttpOnly` + `SameSite=Strict` cookies (+ `Secure` over HTTPS). They expire after 30 days, and logging out kills them instantly.
* **Fake requests from other sites (CSRF):** blocked by a required custom header, strict cookies and an origin check.
* **Malicious text (XSS):** everything people type is shown as plain text, never as code. A strict Content-Security-Policy blocks any outside or inline script.
* **Malicious uploads:** the server checks each file's real type from its first bytes. Only JPG/PNG/GIF/WEBP/MP4/WEBM/MOV are allowed, and SVG or HTML is always rejected. Files are renamed to random names and served with `nosniff`. Size limits are 12 MB for images and 60 MB for videos.
* **Database attacks (SQL injection):** impossible by design, because every query uses prepared statements.
* **Your PC:** the app runs as its own unprivileged user in a systemd sandbox and can only write to `data/`. No router ports are open, and your IP is hidden behind Cloudflare.

Nothing on the internet is 100% safe, but this is solid protection for a private group. The biggest remaining risks are an outdated PC and a leaked group password, so keep the system updated and share the password privately.

## Useful commands

```bash
sudo systemctl restart upipination     # restart after changes
sudo systemctl stop upipination        # stop the site
journalctl -u upipination -n 100       # last 100 log lines
```
