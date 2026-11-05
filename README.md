# LastZ Fieldwork

A server 802 SVS map planner built with TypeScript, SolidJS/SolidStart, Zod and Ark UI. It uses the game's 1,000 × 1,000 odd-row hex coordinate system and seven-tile placement footprints.

[Open the planner](https://p01--lastz-map-planner--clx6wvzz4h7r.code.run/)

**Current fidelity:** coordinate topology is verified from an offline game snapshot. The installed normal-world obstacle asset and November 4 configuration provide a decoded static baseline: 43,279 blocked tiles and 90 city exclusion zones. Server 802 was confirmed by the user as Season 1; the client maps its standard S1 world to this asset. Dynamic occupancy, current events, runtime server overrides, game camera projection and march timing are not live-verified. Strict mode rejects unverified terrain. See [map evidence](docs/map-evidence.md) before using a plan in game.

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
- In **Single headquarters** with a stagger/custom pattern, **Snap to plot** keeps each new HQ on one fixed lattice. The first valid HQ sets the plot anchor, or select an existing HQ and choose **Continue plot from this HQ**. Guide lines and hollow dots show the exact allowed centers; map clicks snap to the nearest center and then check terrain, spacing and collisions. A blocked center is rejected rather than silently shifting the formation.
- Stamp a single HQ, a seven-HQ Daisy, or a 3×4 group. **Build → Preset orientation** previews clockwise/counterclockwise 60° turns and mirrored stagger directions. All centers stay on exact hex coordinates; use `R` / `Shift+R` over the map to turn the placement preview.
- Select any HQ in a placed preset, then use **Inspect → Cluster orientation** to rotate or flip the whole cluster around its saved anchor. Assignments rotate with their HQs; terrain, world bounds, outside buildings and the cluster's original spacing rules are checked atomically. Undo restores the previous arrangement. Individual edits and deletions retain the remaining cluster members.
- Draw closed wedges or open boundaries; move boundaries, drag vertices, rename or erase them.
- Preview a strategy-based fill of a wedge. Every proposed footprint must fit inside the polygon, clear terrain and existing placements, and meet the strategy gap. Review then apply; large fills are explicitly capped.
- Define new reusable strategies through **Manage strategies**, with integer basis vectors, terrain constraints and gaps. Clone presets, edit custom patterns, and import/export validated configurations. No executable strategy code is accepted.
- Inspect an HQ's single-loss opening. When two replacements fit, the map shows a concrete witness pair. Pre-existing nearby openings are reported separately. This is local geometry, not a promise that the whole formation is secure.
- Copy in-game tokens, export assignments as CSV, export the viewport as PNG, and import/export complete JSON plans.
- Share a compressed self-contained link. Recipients get an independent copy; there is no shared server database or live co-editing.
- Plans autosave to this browser. Import and editing support undo/redo. Export JSON for durable backups.

In **Layers**, map individual terrain tiles from in-game evidence. Alternatively, select the standard Season 1 profile to use the decoded baseline, or an unverified/custom profile for manual mapping. Food/Wood must remain off mud; set an alliance leader/rally marker in Layers to enforce the 50-step range for every Food/Wood tile. Choose the marker type to reserve the leader’s seven-tile footprint or the rally point’s single tile. Use the active rally point when one exists; it takes precedence over the leader in game. The measurement tool shows hex distance, not march time.

A complete Daisy repeats its occupied shape every 60°. Rotating a placed Daisy still moves its named assignments around the ring; **Flip stagger** changes the slant of Mud/Grass stagger patterns. Older plans remain compatible: select a preset's anchor HQ, choose its original pattern/formation/orientation in Build, then use **Inspect → Link these HQs** when the matching arrangement is found. This links only the matching unlinked HQs in the selected HQ's group. Smart-filled wedges remain individual placements rather than a preset cluster.

The single-HQ plot anchor is saved with the plan and stays fixed as you add positions. **Plot orientation** rotates/flips the guide without moving existing HQs; continuing from a tracked cluster adopts its orientation and group. Off-plot HQs in the active group are counted for review. Typed coordinates are never silently moved: off-plot entries are rejected, and **Snap coordinates** previews the suggested center before you place it. Use **Start a new plot** to choose a new origin, or turn off snapping for an intentional free placement. Standard By-tile/Tight/Loose mode keeps its existing free-placement behavior. The full Mud/Grass lattice repeats after a 60° rotation; flipping changes its slant.

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

GitHub Actions checks each push and PR. The Dockerfile builds and tests the application and runs the standalone SolidStart server as a non-root user. Northflank hosts the app under **LastZ → Map Planner → lastz-map-planner**, with automatic builds and deployments from `main`. Supabase can later provide accounts and shared persistence. See [deployment instructions](docs/deployment.md).

The planner repository is separate from the research workspace. It includes only derived numeric map facts and provenance, not game source, private captures, account credentials or player datasets.
