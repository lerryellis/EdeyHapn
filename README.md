# EdeyHapn

> **"What's happening near you"** — a real-time local-updates PWA built for Accra, Ghana.

Community members report traffic jams, power cuts, safety alerts, local events, and anything else worth knowing. Posts are GPS-stamped, community-confirmed, and visible on both a live feed and an interactive map.

Live: **https://edeyhapn.up.railway.app**

---

## Architecture at a glance

```
index.html          ← entire frontend (PWA, Leaflet map, all UI logic)
server.js           ← Express API + static file server
db.js               ← node-postgres pool with SSL detection & init retry
schema.sql          ← posts table + indexes (auto-applied on first boot)
.env.example        ← environment variable template
```

The app is intentionally a **single-file frontend** — no build step, no bundler, no framework. `index.html` is served by Express as a static file and also acts as the SPA shell. All JS lives in a `<script>` tag at the bottom of the HTML.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS, Tailwind CSS (CDN), Leaflet.js 1.9 |
| Map tiles | Carto Voyager (light) / Carto Dark Matter (dark) |
| Reverse geocoding | Nominatim (OpenStreetMap) — no API key needed |
| Backend | Node.js 18+, Express 4 |
| Database | PostgreSQL (via `pg` / node-postgres) |
| Hosting | Railway (app + Postgres plugin) |
| PWA | Web App Manifest + Service Worker ready |

---

## Local setup

```bash
git clone https://github.com/lerryellis/EdeyHapn.git
cd EdeyHapn
npm install

# Copy the env template and fill in your local Postgres URL
cp .env.example .env

npm run dev    # nodemon — restarts on file changes
# or
npm start      # plain node
```

The server starts on **http://localhost:3000**. The DB schema is created automatically on first boot — no manual migration step needed.

### `.env` variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Full Postgres connection string |
| `PORT` | HTTP port (default `3000`) |
| `NODE_ENV` | Optional — SSL detection uses the URL, not this |

---

## Database schema

One table: **`posts`**

```sql
id         SERIAL PRIMARY KEY
cat        VARCHAR(20)   -- traffic | event | safety | power | weather | info
label      VARCHAR(100)  -- display label, e.g. "🚨 Traffic"
cls        VARCHAR(200)  -- Tailwind classes for the category badge
text       TEXT          -- the report body
lat        DECIMAL(9,6)
lng        DECIMAL(9,6)
location   VARCHAR(255)  -- human-readable place name from Nominatim
confirms   INT DEFAULT 1 -- community confirmations (starts at 1 = the poster)
helpful    INT DEFAULT 0 -- "this was useful to me" votes
outdated   BOOLEAN       -- true = removed from feed
flagged    BOOLEAN       -- true = shown with "Flagged as unverified" banner
created_at TIMESTAMPTZ
```

Posts are never hard-deleted. `outdated = true` hides them from the feed. `flagged = true` keeps them visible but adds a warning banner — the community can still evaluate and confirm or mark outdated.

---

## REST API

All endpoints are same-origin. `API_BASE` in the frontend is an empty string so it works on Railway and locally without any config changes.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check — returns `{status:"ok", timestamp}` |
| `GET` | `/api/posts?cat=traffic` | Fetch all non-outdated posts. `cat` filter is optional. Returns `{posts:[...]}` |
| `POST` | `/api/posts` | Create a post. Body: `{cat, text, lat, lng, label?, cls?, location?}` |
| `PATCH` | `/api/posts/:id/confirm` | Increment `confirms` by 1 |
| `PATCH` | `/api/posts/:id/helpful` | Increment `helpful` by 1 |
| `PATCH` | `/api/posts/:id/outdated` | Set `outdated = true` (removes from feed) |
| `PATCH` | `/api/posts/:id/flag` | Set `flagged = true` (adds warning banner) |

The `GET /api/posts` query filters by `WHERE outdated = false` — flagged posts are intentionally included so the community can still see and act on them.

---

## Frontend logic worth borrowing

### Optimistic UI updates

State mutations (confirm, helpful, flag, outdated) fire against the API in the background. The local `posts` array is updated immediately so the UI reflects the change without waiting for the network round-trip.

```js
// Example — ctxFlag()
fetch(`/api/posts/${activePost.id}/flag`, { method:'PATCH' }).catch(()=>{});
const idx = posts.findIndex(p => p.id === activePost.id);
if (idx > -1) { posts[idx].flagged = true; renderFeed(); }
```

### Deduplication with a `Set` (voted posts)

Device-local vote deduplication — prevents double-voting across page refreshes without any server-side session:

```js
const votedPosts = new Set(JSON.parse(localStorage.getItem('ehVoted') || '[]'));
function saveVoted() { localStorage.setItem('ehVoted', JSON.stringify([...votedPosts])); }
```

### Multi-select map legend

The category filter is a `Set` that toggles members on/off. Each Leaflet marker is only rendered if its category is in the active set:

```js
let mapFilterActive = new Set(['traffic','event','safety','power','weather','info']);

btn.addEventListener('click', () => {
  const cat = btn.dataset.cat;
  mapFilterActive.has(cat) ? mapFilterActive.delete(cat) : mapFilterActive.add(cat);
  btn.classList.toggle('active');
  renderMapMarkers();
});

// In renderMapMarkers():
const visible = posts.filter(p => mapFilterActive.has(p.cat));
```

### Map tile layer swapping (dark mode)

The main map and location picker both swap between Carto Voyager and Carto Dark Matter when the theme changes. The key is to remove the old layer before adding the new one:

```js
function tileUrl() {
  return darkMode
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
}

function applyTheme() {
  document.body.classList.toggle('dark', darkMode);
  if (mapTileLayer && leafletMap) {
    leafletMap.removeLayer(mapTileLayer);
    mapTileLayer = L.tileLayer(tileUrl(), { maxZoom:19, subdomains:'abcd' }).addTo(leafletMap);
  }
}
```

### Flash-free dark mode on load

Dark mode is applied synchronously before the first render — no FOUC:

```js
let darkMode = localStorage.getItem('ehTheme') === 'dark';
if (darkMode) document.body.classList.add('dark'); // runs immediately, before DOM paint
```

### Draggable location picker

Before posting, users can adjust their GPS pin on a second Leaflet map inside a bottom sheet. The picked coordinates are held in module-level variables and only committed to report state when the user taps Confirm:

```js
let pickedLat = null, pickedLng = null;

function openLocationPicker() {
  pickedLat = reportLat; pickedLng = reportLng;
  openSheet('locationPickerSheet');
  // ...initialise or reposition locPickerMap with a draggable marker
}

function confirmPickedLocation() {
  reportLat = pickedLat; reportLng = pickedLng;
  reportLocation = document.getElementById('pickerLabel').textContent;
  openSheet('reportSheet');
}
```

Reverse geocoding on drag end uses Nominatim — free, no key required:

```js
async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
  const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const d = await r.json();
  return d.display_name?.split(',').slice(0,3).join(', ') || 'Unknown location';
}
```

### Community trust signals

- **5+ confirms** → card gets a green left border (`card-verified`) and a `✅` prefix on the count
- **Flagged** → card gets a red border (`card-flagged`) and a warning banner; post stays visible so others can confirm or dismiss it
- **Outdated** → post is removed from feed entirely (server-side filter)

```js
// In the card template:
class="card p-5${p.flagged ? ' card-flagged' : p.confirms >= 5 ? ' card-verified' : ''}"
```

### Swipe gestures on cards

Cards support touch/mouse swipe: **swipe right** to confirm, **swipe left** to open the share sheet. A long-press opens the context menu (flag / mark outdated / share). All three are detected from the same `touchstart`/`touchmove`/`touchend` listeners with a shared `dragging` flag and a 520 ms long-press timer.

### Points & rank progression

Posting and confirming earn local points stored in `localStorage`. The rank ladder:

| Points | Rank |
|---|---|
| 0 | Local Reporter |
| 50 | Community Eyes |
| 150 | Street Insider |
| 300 | City Voice |
| 600 | EdeyHapn Pro |
| 1200 | Legend of Accra |

---

## Deployment on Railway

1. Create a new project → **Deploy from GitHub repo**
2. Add a **PostgreSQL** plugin to the project
3. In the app service **Variables** tab, add:
   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   ```
   The `${{...}}` syntax is Railway's reference variable — it injects the Postgres URL at runtime.
4. Deploy. The server starts, passes Railway's health check on `/api/health`, then `initDB()` runs with automatic retry (5 attempts, 3 s apart) to handle the brief window where Postgres isn't yet reachable.

### Why the server starts before `initDB()`

Railway kills a deployment if the health check doesn't respond within the boot timeout. Because `initDB()` may take a few seconds (or retry for up to 15 s on a cold start), the HTTP server binds first and `initDB()` is called asynchronously afterward. API routes return `500` until the DB is ready, but the health check always passes immediately.

---

## DB connection — SSL detection

SSL is required for Railway/Render Postgres but must be disabled for local Postgres. The detection is based on the URL, not `NODE_ENV`, so a missing env var can't accidentally break it:

```js
const isLocal = !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes('localhost') ||
  process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
```

---

## Contributing

Issues and PRs are welcome. A few things to know before you dig in:

- **No build step.** Edit `index.html`, `server.js`, or `db.js` directly. Refresh the browser.
- **`nodemon`** is configured as the dev server (`npm run dev`). It watches all JS files and `index.html`.
- **Tailwind is CDN-only.** There is no PostCSS / Tailwind CLI. Dark mode overrides that can't be expressed with utilities are in the `<style>` block inside `index.html`.
- **The DB schema is idempotent.** `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` mean you can restart the server safely at any time — it won't recreate or wipe existing data.
- **`schema.sql`** is provided for manual inspection or one-shot setup in Railway's Data → Query tab. It is not run by any script; `db.js` applies the same DDL programmatically.
