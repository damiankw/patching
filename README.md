# Rackdocs

Self-hosted network and rack documentation for internal use. Document sites, floors, rooms and racks, place devices in racks, record every port-to-port cable, and trace a connection end to end through patch panels. Single Node process with a SQLite database file. No external services and no native modules: SQLite runs as WebAssembly, so `npm install` needs no compiler.

## What it does

- **Hierarchy:** unlimited sites, floors, rooms and racks.
- **Rack editor:** front and rear views, drag devices to move them, click an empty slot to add one. Overlaps and out-of-range placements are rejected.
- **Device library:** 19 built-in templates (patch panels, switches, routers, firewalls, servers, storage, PDU, UPS, blanks). Add your own with any port layout.
- **Ports and connections:** every device gets ports from its template. Connect any port to any other port in any rack or site. Record cable type, colour, label and length.
- **Path tracing:** patch panels are pass-through devices, so a trace from a switch port follows the cable to the panel, through the panel, and on to the far device.
- **VLANs:** defined per site, assigned to switch ports.
- **Activity log:** who changed what and when.
- **Search:** sites, racks, devices, serial numbers, IP addresses, VLANs.
- **CSV export:** racks, devices, ports, connections, VLANs.
- **Users and roles:** admin, editor, viewer. Email and password login.

## Run with Docker

```bash
docker compose up -d --build
```

Open http://localhost:3000 and create the first admin account. Data lives in the `rackdocs-data` volume as a single SQLite file.

## Run locally without Docker

Requires Node 22 or newer.

```bash
npm install
npm run build
npm start
```

For development with hot reload:

```bash
npm run dev
```

The web app is then on port 5173 (all interfaces) and proxies API calls to the server on port 3000.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `0.0.0.0` | Interface to bind. Use `127.0.0.1` to restrict to the local machine |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` (or `/data` in Docker) | Folder holding `rackdocs.db` |
| `COOKIE_SECURE` | unset | Set to `1` when served over HTTPS so the session cookie is marked Secure |

## Troubleshooting

**Node version.** Node 20 or newer is required. Check with `node -v`.

**`database is locked` or "Another rackdocs instance appears to be using" on start.** The app keeps a `rackdocs.pid` file and the SQLite driver keeps a `rackdocs.db.lock` folder in the data directory while running. Stale ones from a crash are cleaned up automatically. If the app refuses to start and you are sure nothing else is running, delete both and start again.

**Port already in use.** Set `PORT` to something else, or stop the other process.

## Backups

The database is the single file `rackdocs.db` in the data folder. Stop the app (or the container) and copy that file. With Docker:

```bash
docker compose stop && docker compose cp rackdocs:/data/rackdocs.db ./rackdocs-backup.db && docker compose start
```

## Concepts

- **Device ID** is unique within a rack (for example `SW01`, `PP01`). Site, floor, room and rack codes are unique within their parent. All codes are uppercased.
- **Pass-through** device types (patch panels) link front port N to rear port N. Model structured cabling as: switch port, cable, panel front port, pass-through, panel rear port, cable, outlet or far-end device.
- **Position** is the bottom rack unit a device occupies. A 2U device at U10 occupies U10 and U11.
- Editing a device type's ports changes the template only. Devices already placed keep their existing ports.

## Not included (yet)

Floor plan images with room drawing, PDF reports, bulk import, and an external API token. The REST API under `/api` is cookie-authenticated and can be scripted with a logged-in session.
