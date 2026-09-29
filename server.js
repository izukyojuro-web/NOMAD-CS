require("dotenv").config();

const express = require("express");
const session = require("express-session");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const GameDig = require("gamedig");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SERVER_API_KEY = process.env.SERVER_API_KEY || "change-this-secret";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultDB = {
  nextMemberId: 1,
  players: [],
  servers: [
    { id: 1, name: "NOMAD #01", host: "127.0.0.1", port: 27015, mode: "Competitive", map: "Offline", online: false, players: 0, maxPlayers: 50, lastSeen: null },
    { id: 2, name: "NOMAD #02", host: "127.0.0.1", port: 27016, mode: "Competitive", map: "Offline", online: false, players: 0, maxPlayers: 50, lastSeen: null },
    { id: 3, name: "NOMAD #03", host: "127.0.0.1", port: 27017, mode: "Retake", map: "Offline", online: false, players: 0, maxPlayers: 40, lastSeen: null }
  ]
};

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDB, null, 2));
}

function readDB() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function nextMemberId(db) {
  const id = String(db.nextMemberId).padStart(4, "0");
  db.nextMemberId++;
  return id;
}

function findOrCreateSteamPlayer(steamId, profile = {}) {
  const db = readDB();
  let player = db.players.find(p => p.steamId === steamId);

  if (!player) {
    player = {
      memberId: nextMemberId(db),
      steamId,
      name: profile.personaname || `Steam ${steamId}`,
      avatar: profile.avatarfull || "",
      rank: "UNRANKED",
      points: 0,
      kills: 0,
      deaths: 0,
      wins: 0,
      matches: 0,
      playtime: 0,
      discordId: null,
      createdAt: new Date().toISOString()
    };
    db.players.push(player);
    writeDB(db);
  } else if (profile.personaname) {
    player.name = profile.personaname;
    player.avatar = profile.avatarfull || player.avatar;
    writeDB(db);
  }

  return player;
}

async function getSteamProfile(steamId) {
  if (!process.env.STEAM_API_KEY) return {};
  const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
  url.searchParams.set("key", process.env.STEAM_API_KEY);
  url.searchParams.set("steamids", steamId);

  const response = await fetch(url);
  if (!response.ok) return {};
  const json = await response.json();
  return json.response?.players?.[0] || {};
}

function openidParams(req) {
  const params = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (key.startsWith("openid.")) params[key] = value;
  }
  return params;
}

async function verifySteamOpenID(params) {
  if (!params["openid.claimed_id"] || !params["openid.sig"]) return null;

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    body.set(key, String(value));
  }
  body.set("openid.mode", "check_authentication");

  const response = await fetch("https://steamcommunity.com/openid/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const text = await response.text();
  if (!text.includes("is_valid:true")) return null;

  const claimed = params["openid.claimed_id"];
  const match = claimed.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/);
  return match ? match[1] : null;
}

app.get("/auth/steam", (req, res) => {
  const returnTo = `${BASE_URL}/auth/steam/return`;

  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": BASE_URL,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
  });

  res.redirect(`https://steamcommunity.com/openid/login?${params.toString()}`);
});

app.get("/auth/steam/return", async (req, res) => {
  try {
    const params = openidParams(req);
    const steamId = await verifySteamOpenID(params);

    if (!steamId) return res.status(401).send("Steam login verification failed.");

    const profile = await getSteamProfile(steamId);
    const player = findOrCreateSteamPlayer(steamId, profile);

    req.session.player = player;
    res.redirect("/?login=success");
  } catch (error) {
    console.error(error);
    res.status(500).send("Steam login error.");
  }
});

app.get("/api/me", (req, res) => {
  res.json({ loggedIn: !!req.session.player, player: req.session.player || null });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/stats", (req, res) => {
  const db = readDB();
  const onlinePlayers = db.servers.reduce((sum, s) => sum + (s.online ? s.players : 0), 0);
  const onlineServers = db.servers.filter(s => s.online).length;

  res.json({
    onlinePlayers,
    onlineServers,
    registeredPlayers: db.players.length
  });
});

app.get("/api/servers", (req, res) => {
  res.json(readDB().servers);
});

app.get("/api/leaderboard", (req, res) => {
  const db = readDB();
  res.json([...db.players].sort((a,b) => b.points - a.points));
});

app.get("/api/player/:memberId", (req, res) => {
  const player = readDB().players.find(p => p.memberId === req.params.memberId);
  if (!player) return res.status(404).json({ error: "Player not found" });
  res.json(player);
});

/*
  CS2 live heartbeat:
  POST /api/server/heartbeat
  Header: x-server-key: SERVER_API_KEY

  Body:
  {
    "id": 1,
    "name": "NOMAD #01",
    "map": "de_mirage",
    "players": 17,
    "maxPlayers": 50,
    "online": true
  }
*/
app.post("/api/server/heartbeat", (req, res) => {
  if (req.headers["x-server-key"] !== SERVER_API_KEY) {
    return res.status(401).json({ error: "Invalid server key" });
  }

  const db = readDB();
  const incoming = req.body;
  const server = db.servers.find(s => s.id === Number(incoming.id));

  if (!server) return res.status(404).json({ error: "Server not found" });

  if (incoming.name) server.name = incoming.name;
  if (incoming.map) server.map = incoming.map;
  if (Number.isFinite(Number(incoming.players))) server.players = Number(incoming.players);
  if (Number.isFinite(Number(incoming.maxPlayers))) server.maxPlayers = Number(incoming.maxPlayers);
  server.online = incoming.online !== false;
  server.lastSeen = new Date().toISOString();

  writeDB(db);
  res.json({ ok: true, server });
});

/*
  Automatic A2S/GameDig polling.
  Put your real CS2 server IP/ports into data/db.json.
*/
async function pollServers() {
  const db = readDB();

  for (const server of db.servers) {
    try {
      const state = await GameDig.query({
        type: "cs2",
        host: server.host,
        port: server.port,
        maxRetries: 1,
        socketTimeout: 1500,
        attemptTimeout: 1500
      });

      server.online = true;
      server.map = state.map || server.map;
      server.players = state.players?.length ?? state.numplayers ?? 0;
      server.maxPlayers = state.maxplayers || server.maxPlayers;
      server.lastSeen = new Date().toISOString();
    } catch {
      server.online = false;
      server.players = 0;
    }
  }

  writeDB(db);
}

setInterval(pollServers, 10000);
pollServers();

app.get("/auth/discord", (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirect = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !redirect) {
    return res.status(503).send("Discord OAuth is not configured yet.");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: "identify"
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing Discord code.");

  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.DISCORD_REDIRECT_URI
  });

  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const token = await tokenResponse.json();
    if (!token.access_token) return res.status(401).send("Discord authorization failed.");

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });

    const discordUser = await userResponse.json();

    if (req.session.player) {
      const db = readDB();
      const player = db.players.find(p => p.memberId === req.session.player.memberId);
      if (player) {
        player.discordId = discordUser.id;
        writeDB(db);
        req.session.player = player;
      }
    }

    res.redirect("/?discord=success");
  } catch (error) {
    console.error(error);
    res.status(500).send("Discord login error.");
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`NOMAD CS: ${BASE_URL}`);
});
