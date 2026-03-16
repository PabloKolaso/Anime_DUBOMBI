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

---

## ⚠️ Legal Disclaimer

This addon does **not** host, store, or distribute any media files. All stream links are provided by non-affiliated third parties and are not controlled by this project.

**Third-party services** — this project uses the following external services and is not affiliated with, endorsed by, or associated with any of them:

| Service | Use |
|---------|-----|
| **HiAnime** | Primary anime stream source (via [`aniwatch`](https://github.com/ghoshRitesh12/aniwatch)) |
| **AnimeKai / Gogoanime** | Fallback stream source (via [`@consumet/extensions`](https://github.com/consumet/consumet.ts)) |
| **AniList** | Anime metadata and canonical title lookup (GraphQL API, [AniList ToS](https://anilist.co/terms)) |
| **IMDB** | Title and genre lookup from public HTML pages ([IMDB Conditions of Use](https://www.imdb.com/conditions)) |
| **Fribb anime-lists** | IMDB ↔ AniList ID mapping dataset ([GitHub](https://github.com/Fribb/anime-lists), MIT) |

Accessing third-party websites through scrapers may be restricted by their Terms of Service. You are solely responsible for ensuring your use of this software complies with the terms of each service and with the laws and regulations of your jurisdiction.

All trademarks, service marks, and trade names referenced here are the property of their respective owners.

The authors of this project bear no liability for how it is used.

---

## License

MIT — see [LICENSE](LICENSE) for full text.
