# Deployment Guide

This covers taking the app from "running on my laptop" to "running reliably on a server,
behind a real domain, with HTTPS." Skip any section you don't need yet.

## 1. Get the code onto your server

```bash
# Copy the project to the server, e.g. via scp, git, or unzip directly there
scp -r receipt-system user@your-server-ip:/var/www/receipt-system
ssh user@your-server-ip
cd /var/www/receipt-system
npm install
npm run seed        # only the first time, to create demo accounts
```

Then immediately go change the demo passwords / create real accounts and delete the demo ones
(see the main README).

## 2. Keep it running with PM2

PM2 is a process manager: it keeps the app alive, restarts it if it crashes, and can bring it
back up automatically after a server reboot.

```bash
sudo npm install -g pm2

# From inside the receipt-system folder:
npm run pm2:start
```

This uses the included `ecosystem.config.js`, which:
- Runs `server.js` under the name `receipt-system`
- Restarts automatically if it crashes
- Restarts if memory usage exceeds 300MB (safety net against leaks)
- Writes logs to `logs/out.log` and `logs/error.log`

Useful commands:
```bash
pm2 status                 # see if it's running
npm run pm2:logs           # tail the logs
npm run pm2:restart        # restart after a code change
pm2 startup                # generates a command to auto-start PM2 on server reboot — run the command it prints
pm2 save                   # save the current process list so it's restored on reboot
```

## 3. Put it behind Nginx with a real domain

By default the app listens on `http://localhost:3000`, which isn't reachable from the internet
directly (and shouldn't be — Nginx in front gives you proper HTTP handling, gzip, and a place to
attach SSL).

```bash
sudo apt-get install -y nginx
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/receipt-system
sudo nano /etc/nginx/sites-available/receipt-system
# replace "yourdomain.com" with your actual domain
# replace "/var/www/receipt-system/public/" with the actual absolute path to your project's public folder

sudo ln -s /etc/nginx/sites-available/receipt-system /etc/nginx/sites-enabled/
sudo nginx -t                      # check config for errors
sudo systemctl reload nginx
```

Point your domain's DNS A record at your server's IP address before this step, so Certbot (next
step) can verify ownership.

## 4. Add HTTPS (free, via Let's Encrypt)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot edits the Nginx config automatically to redirect HTTP → HTTPS and sets up auto-renewal
(it renews itself via a cron job/systemd timer — no action needed later).

## 5. Production hardening checklist

- [ ] Change the session secret in `server.js` (`secret: 'receipt-system-secret-change-me'`) to a long random string
- [ ] Delete or disable the demo admin/cashier accounts, create real ones
- [ ] Set up a daily backup of `db/data.sqlite` and `public/uploads/` (cron + `rsync`/cloud storage)
- [ ] Restrict SSH/firewall access on the server (e.g. `ufw allow 80,443,22/tcp` and nothing else)
- [ ] Confirm `pm2 startup` + `pm2 save` were run so the app survives a server reboot

## 6. Updating the app later

```bash
cd /var/www/receipt-system
# pull in your new files / git pull
npm install              # in case dependencies changed
npm run pm2:restart
```

---
Developed by [Dantechdevs Developers](https://dantechdevelopers.com)
