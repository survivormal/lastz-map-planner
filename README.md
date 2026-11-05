# LastZ Fieldwork

A server 802 SVS map planner built with TypeScript, SolidJS/SolidStart, Zod and Ark UI. It uses the game's 1,000 × 1,000 odd-row hex coordinate system and seven-tile placement footprints.

**Current fidelity:** coordinate topology is verified from an offline game snapshot. The installed normal-world obstacle asset and November 4 configuration provide a decoded static baseline: 43,279 blocked tiles and 90 city exclusion zones. Active server 802 season applicability, dynamic occupancy, current events, game camera projection and march timing are not yet verified. Strict mode rejects unverified terrain. See [map evidence](docs/map-evidence.md) before using a plan in game.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open [localhost:3100](http://127.0.0.1:3100). Production: `npm run build` then `npm start` (port 3000).

## Planning

- Select, pan and zoom across the entire world; all placements snap to integer world coordinates.
- Place seven-tile HQs and alliance Food/Wood blockers. Name assignments and organize color-coded groups.
- Use standard spacing (touching, one empty tile, two empty tiles), Mud optimized stagger `(3,1)`, or Grass wide stagger `(3,2)`.
- Stamp a single HQ, a seven-HQ Daisy, or a 3×4 group. Rotate patterns in 60° steps.
- Draw closed wedges or open boundaries; move boundaries, drag vertices, rename or erase them.
- Preview a strategy-based fill of a wedge. Every proposed footprint must fit inside the polygon, clear terrain and existing placements, and meet the strategy gap. Review then apply; large fills are explicitly capped.
- Define new reusable strategies through **Manage strategies**, with integer basis vectors, terrain constraints and gaps. Clone presets, edit custom patterns, and import/export validated configurations. No executable strategy code is accepted.
- Inspect an HQ's single-loss opening. When two replacements fit, the map shows a concrete witness pair. Pre-existing nearby openings are reported separately. This is local geometry, not a promise that the whole formation is secure.
- Copy in-game tokens, export assignments as CSV, export the viewport as PNG, and import/export complete JSON plans.
- Share a compressed self-contained link. Recipients get an independent copy; there is no shared server database or live co-editing.
- Plans autosave to this browser. Import and editing support undo/redo. Export JSON for durable backups.

In **Layers**, map individual terrain tiles from in-game evidence. Alternatively, explicitly enable the cached normal-world terrain to plan against that baseline. Food/Wood must remain off mud; leader/rally placement range is not yet checked. The measurement tool shows hex distance, not march time.

Keyboard: `V` select, `H` pan, `B` HQ, `F` food, `W` wood, `L` boundary, `M` measure, `T` terrain, `E` erase, `Space`+drag pan, `Enter` close a wedge, `Escape` cancel, `Delete` remove selection, `⌘/Ctrl+Z` undo, `⇧⌘/Ctrl+Z` redo. Coordinates can also be entered without pointing at the map.

## Stack and validation

Pinned on November 5, 2026: Solid 1.9.18, SolidStart 2.2.1, TypeScript 7.0.2, Ark UI Solid 5.40.0, Zod 4.6.7 and Vite 8.3.6. SolidStart's official Nitro 3 integration is currently a pinned release candidate.

```sh
npm run typecheck
npm test
npm run build
```

Tests cover offset/axial round trips, world bounds, parity, footprints, clearance, movement rules, concave wedges, reference patterns, loss-analysis witnesses, custom strategy validation, bounded smart filling, plan storage and exports, share links, and HTTP body limits.

`GET /api/health` is a readiness endpoint. `POST /api/validate` validates a raw plan JSON body (2 MiB maximum). It is stateless and does not verify terrain or persist plans.

## Repository and deployment

GitHub: [survivormal/lastz-map-planner](https://github.com/survivormal/lastz-map-planner).

GitHub Actions checks each push and PR. The Dockerfile builds and tests the application and runs the standalone SolidStart server as a non-root user. Northflank is the intended application host; Supabase can later provide accounts and shared persistence. See [deployment instructions](docs/deployment.md).

The planner repository is separate from the research workspace. It includes only derived numeric map facts and provenance, not game source, private captures, account credentials or player datasets.
