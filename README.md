# NOMAD CS

A starter full-stack CS2 community site.

## 1. Install

Install Node.js LTS.

Open this folder in VS Code, then Terminal:

```bash
npm install
```

## 2. Environment

Copy `.env.example` to `.env`.

Windows PowerShell:

```powershell
copy .env.example .env
```

Do not share `.env`.

## 3. Start

```bash
npm start
```

Open:

http://localhost:3000

Do NOT open `public/index.html` directly and do NOT use Live Server.

## Features included

- Express backend
- Persistent local JSON database
- Member IDs starting at #0001
- Steam OpenID browser login
- Optional Steam profile lookup
- Player profiles
- Leaderboard
- Live server counter
- CS2 server A2S/GameDig polling
- Secure server heartbeat endpoint
- Discord OAuth2 connection skeleton
- NOMAD Discord invite

## Real CS2 servers

Edit `data/db.json` and replace:

- `127.0.0.1`
- `27015`
- `27016`
- `27017`

with your real CS2 server IP/ports.

The backend polls them every 10 seconds.

## Steam

For profile names/avatars, put a Steam Web API key in `.env`:

STEAM_API_KEY=...

Steam browser authentication itself uses Steam OpenID.

## Discord

Create a Discord application, then put its client ID/secret in `.env` and set this redirect URI in the Discord developer portal:

http://localhost:3000/auth/discord/callback

Never send the client secret to anyone.

## Production

Before public deployment, use HTTPS, a real database, a persistent session store, strong secrets and a reverse proxy.
