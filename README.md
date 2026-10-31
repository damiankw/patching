# Rackdocs

Self-hosted network and rack documentation for internal use, modelled on the workflow of commercial tools: document locations, floors, rooms and racks on floor plans, record permanent (building) cabling and patch (user) cabling separately, and trace any port end to end. Single Node process with a SQLite database file. No external services and no native modules.

## What it does

- **Map View.** Locations on a map with cards showing floors, rooms, devices and address. Address lookup places the marker.
- **Location View.** Floor tabs, device palette, floor plan upload with real-world scaling, rectangle and polygon rooms, device pins with auto-generated IDs, settings sidebar with auto-save, bottom devices and connections panel. Building connections draw as dashed orange lines, user connections as solid blue.
- **Rack Editor.** Drag templates into rack units or click an empty unit, front and back views, port-level rendering with connection states (unconnected, incomplete, complete, keystone), drag from port to port to patch, VLAN assignment and highlighting, exports (PDF, PNG, bill of materials).
- **Connections.** Every port can carry one building connection and one user connection. Patch panel and outlet ports need a building connection before they can be patched. The Connection Overview shows the full hop-by-hop path and whether it is complete. One colour per chain.
- **Networks.** VLANs and WLANs defined once and assigned to ports anywhere.
- **Resources.** Locations, floors, rooms, devices, ports and connections in sortable, filterable tables with CSV export.
- **Device Library.** Standard device types with editable ID prefixes, custom types, and rack device templates with a port layout editor.
- **Activity Log** with filters, **global search** (Ctrl K), light and dark themes, admin / editor / viewer roles.

## Run with Docker

```bash
docker compose up -d --build
```

Open http://localhost:3000 and create the account and first administrator. Data lives in the `rackdocs-data` volume: the SQLite file plus uploaded floor plans and photos.

## Run locally without Docker

Requires Node 20 or newer.

```bash
npm ci
npm run build
npm start
```

Use `npm ci` rather than `npm install`: it installs exactly what the lockfile says and never rewrites it, so a later `git pull` is not blocked by a modified `package-lock.json`.

To update to a newer version:

```bash
git pull && npm ci && npm run build
```

For development with hot reload (`npm run dev`), the web app is on port 5173 and proxies API calls to the server on port 3000.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `0.0.0.0` | Interface to bind. Use `127.0.0.1` to restrict to the local machine |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` (or `/data` in Docker) | Folder holding `rackdocs.db` and `uploads/` |
| `COOKIE_SECURE` | unset | Set to `1` when served over HTTPS so the session cookie is marked Secure |

## Quickstart

1. Add a location. A Ground Floor is created with it; rename it in the settings sidebar.
2. Upload a floor plan, then click **Scale floor plan** and measure a known distance.
3. Draw rooms with the rectangle or polygon tool and give each a short ID.
4. Add a Rack, a Telecommunications Outlet and a Printer by dragging from the palette or with **+ Device**.
5. Select the rack and click **Configure rack**. Add a patch panel and a switch.
6. Select the outlet on the floor and click **Manage building connections**. Point its port at the patch panel port in the rack. A dashed orange line appears.
7. In the rack, drag from the patch panel port to a switch port. That is a user connection.
8. Select the printer, click the plug icon on its port, and pick the outlet in the Connection Configurator. The port now shows the complete path switch → panel → outlet → printer.

## Concepts

- **IDs** are short, uppercase and unique within their parent. The full path reads `LOCATION/FLOOR/ROOM/[RACK/]DEVICE/PORT`. Devices outside any room belong to the implicit `DEFAULT` room.
- **Building connections** are the permanent cabling and only terminate at passive devices (patch panels, outlets). **User connections** are patch cables. Removing a building connection also removes the patch cables that depended on it.
- **Port states.** Light grey outline: unconnected. Light blue: part of an incomplete chain. Solid blue: part of a chain that ends at active devices on both sides. Black: a patch panel port with its building connection in place (the keystone). Dashed empty frame: a panel port with no building connection, nothing to plug into yet.
- Editing a device type's ports or a template changes new devices only. Devices already placed keep their ports.

## Troubleshooting

**Upgrading from the first release.** The first release used a different data model. On start the old `rackdocs.db` is renamed to `rackdocs-v1-backup-<date>.db` and a fresh database is created.

**`git pull` says package-lock.json would be overwritten.** An earlier `npm install` rewrote the lockfile. Discard that change and pull again:

```bash
git checkout -- package-lock.json && git pull && npm ci
```

**`database is locked` or "Another rackdocs instance appears to be using" on start.** The app keeps a `rackdocs.pid` file and the SQLite driver keeps a `rackdocs.db.lock` folder in the data directory while running. Stale ones from a crash are cleaned up automatically. If the app refuses to start and you are sure nothing else is running, delete both and start again.

**Map tiles or address lookup not loading.** Both come from OpenStreetMap over the internet. The rest of the app works without them.

## Backups

Stop the app (or the container) and copy the data directory: `rackdocs.db` plus the `uploads/` folder. With Docker:

```bash
docker compose stop && docker compose cp rackdocs:/data ./rackdocs-backup && docker compose start
```

## Not included

Tenant switching for multiple customers, per-resource permissions, patchbox cassette modelling, and bulk import. The REST API under `/api` is cookie-authenticated and can be scripted with a logged-in session.
