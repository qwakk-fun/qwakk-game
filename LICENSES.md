# Licenses and asset sources

| Asset | Source | License |
| --- | --- | --- |
| Duck models (classic and mallard), animations, rifle, pistol (`apps/client/public/models/`) | Made for Qwakk by script in this repo (`art/`) | Owned by Qwakk |
| Sound effects (gunshots, reloads, hit marker, headshot, kill confirm, quack, damage) | Synthesized at runtime with WebAudio in `apps/client/src/audio/sound.ts`; no sample files | Owned by Qwakk |
| Ground textures (`apps/client/public/textures/ground/`) | Procedural, made for Qwakk by script in this repo (`art/ground/`, Blender and numpy); no photos, scans or texture packs | Owned by Qwakk |
| Greybox island, effects, HUD | Generated in code in this repo | Owned by Qwakk |
| Menu art (`apps/client/public/ui/duck-rifle.webp`, `duck-mallard-rifle.webp`) | Resized from `art/renders/hold_rifle_three_quarter.png` and `art/renders/mallard/hold_rifle_three_quarter.png` (the art build writes the second) | Owned by Qwakk |
| Brand mark (`apps/client/public/ui/brand-mark.svg`) | Copy of `qwakk-landing/public/brand-mark.svg` | Owned by Qwakk |
| Geist and Geist Mono fonts (menu and admin, bundled from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` 5.3.0) | Vercel, via npm (self-hosted, no font CDN) | SIL Open Font License 1.1 |
| `postgres` 3.4.9 (server database client) | npm | Unlicense (public domain) |
| recast-navigation 0.43.1 (`@recast-navigation/*`, bot navmesh on the server) | npm | MIT |
| Three.js, Rapier, Colyseus, Vite and other npm dependencies | npm | Their own licenses (MIT, Apache-2.0), see `node_modules/*/LICENSE` |

No third-party sound packs, textures or models are used. Before adding any, record the source and license here. Do not use Synty assets (their license bans blockchain projects).
