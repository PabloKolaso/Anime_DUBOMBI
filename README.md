<p align="center">
  <img src="logo/logo.png" alt="Anime DUBOMBI" width="480"/>
</p>

# Anime DUBOMBI

> English dubbed anime streams for [Stremio](https://www.stremio.com/)

A self-hosted Stremio addon that finds and serves English dub streams for anime series and movies. Uses HiAnime as the primary source with AnimeKai/Gogoanime as a fallback.

---

## Features

- English dub streams for anime series & movies
- Primary source: HiAnime (MegaCloud / VidStreaming)
- Fallback source: AnimeKai / Gogoanime
- Automatic IMDB ID → HiAnime ID mapping (Fribb + AniList + fuzzy search)
- Multi-season offset handling for split-cour anime
- Admin dashboard at `/dashboard` — analytics, logs, failed lookups
- Disk-persisted cache and logs across restarts

---

## Self-Hosting

### Requirements

- Node.js 18+
- npm

### Install & Run

```bash
npm install
npm start
```

The addon will be available at `http://localhost:7001/manifest.json`.

For development with auto-reload:

```bash
npm run dev
```

### Environment Variables

| Variable     | Default                        | Description                              |
|--------------|--------------------------------|------------------------------------------|
| `PORT`       | `7001`                         | HTTP port to listen on                   |
| `PUBLIC_URL` | `http://localhost:<PORT>`      | External URL (enables 12-min keep-alive) |

**Windows:**
```cmd
set PORT=8000 && set PUBLIC_URL=https://your-host.com && npm start
```

**Linux / macOS:**
```bash
PORT=8000 PUBLIC_URL=https://your-host.com npm start
```

---

## Install in Stremio

1. Start the addon server (`npm start`)
2. Open Stremio → Settings → Add-ons → Install Add-on
3. Paste: `http://localhost:7001/manifest.json`
4. Click **Install**

> If hosting remotely, replace `localhost:7001` with your `PUBLIC_URL`.

---

## Endpoints

| Path | Description |
|------|-------------|
| `/manifest.json` | Stremio addon manifest |
| `/dashboard` | Admin dashboard (overview, analytics, logs) |
| `/health` | Health check (`{"status":"ok"}`) |
| `/debug/resolve/:imdbId` | Debug IMDB → HiAnime ID resolution |

---

## ⚠️ Legal Disclaimer

This addon does **not** host, store, or distribute any media files.
All stream links are provided by non-affiliated third parties and are not controlled by this project.
By using this addon, you accept full responsibility for compliance with the laws and regulations of your jurisdiction.
The authors of this project bear no liability for how it is used.

---

## License

MIT
