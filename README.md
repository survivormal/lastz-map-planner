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
- **Layers → Terrain appearance** switches between game-style olive grass / sandy mud and the darker tactical view. Game terrain uses subtle texture, decorative trees and verified capital/turret reference markers. Restricted ground retains a separate hatch and boundary overlay; appearance never changes tile coordinates, exclusions or placement rules.
- Place seven-tile HQs and alliance Food/Wood blockers. Name assignments and organize color-coded groups.
- Use standard spacing (touching, one empty tile, two empty tiles), Mud optimized stagger `(3,1)`, or Grass wide stagger `(3,2)`.
- In **Single headquarters** with a stagger/custom pattern, **Snap to plot** keeps each new HQ on one fixed lattice. The first valid HQ sets the plot anchor, or select an existing HQ and choose **Continue plot from this HQ**. Guide lines and hollow dots show the exact allowed centers; map clicks snap to the nearest center and then check terrain, spacing and collisions. A blocked center is rejected rather than silently shifting the formation.
- Stamp a single HQ, a seven-HQ Daisy, or a 3×4 group. **Build → Preset orientation** previews clockwise/counterclockwise 60° turns and mirrored stagger directions. All centers stay on exact hex coordinates; use `R` / `Shift+R` over the map to turn the placement preview.
- Select any HQ in a placed preset, then use **Inspect → Cluster orientation** to rotate or flip the whole cluster around its saved anchor. Assignments rotate with their HQs; terrain, world bounds, outside buildings and the cluster's original spacing rules are checked atomically. Undo restores the previous arrangement. Individual edits and deletions retain the remaining cluster members.
- Draw closed wedges or open boundaries; click the first corner again or **Close wedge** to finish an area. **Undo point** corrects the unfinished outline. Repeated clicks and redundant closing corners in saved boundaries are handled automatically when filling; actual crossings still need correction. Move boundaries, drag vertices, rename or erase them.
- **Build → Boundary auto-fill** fills a closed wedge, with **Auto-tighten** selected by default. Draw a boundary or choose an existing one, then choose the preferred strategy, group for new HQs, rotation/flip and starting anchor in Inspect. Built-in and custom strategies provide the starting pattern. Center the anchor in the area, continue the existing plot anchor, enter coordinates, or pick a tile/existing HQ on the map; choosing an anchor does not place an HQ.
- **Optimize boundary fill** compares complete layouts, adds infill, and rearranges HQs whose full seven-tile footprints lie inside the boundary. Existing names and assignments stay with their HQs. HQs wholly or partly outside the boundary, plus all Food/Wood blockers, remain fixed. Automatic adjustments may use touching spacing or move off the chosen plot, while every destination must fit wholly inside the drawn polygon, avoid collisions and use known legal terrain.
- In automatic mud filling, the user’s planning rule permits an HQ to straddle the grass edge when **at least one of its seven tiles touches mud**; its remaining tiles may be grass. Existing mud-touching HQs retain a mud tile, and existing pure-grass HQs stay wholly on grass. This rule does not establish in-game shield behavior. The drawn boundary still contains the entire footprint, and restricted tiles remain unusable.
- The optimized preview compares **two-HQ loss warnings** and **open HQ centers** inside the boundary against the chosen strategy’s starting fill. Open centers are overlapping candidate locations, not a count of enemies that fit simultaneously. Coral outlines and **Review preview warnings** show exact Enemy A/B footprints after a single HQ loss; outside-HQ warnings are reported separately. Boundary lines never obstruct enemies. Unknown terrain, invalid fixed placements, residual openings and search limits remain explicit. If openings remain, enlarge the area to allow more HQs to adjust, confirm the terrain and rerun automatic optimization.
- **Apply optimized layout**, or **Apply best found layout** when warnings or search limits remain, applies the reviewed additions and rearrangement as one undoable edit. Undo restores all prior positions and assignments. Cancel leaves placements unchanged; plan or pattern edits discard stale previews, and applying rechecks the proposal. Automatic searches are bounded to 500 HQs inside the area, 250 new HQs and 20,000 candidate centers, with further work limits for complex boundaries. They seek improvements rather than guarantee maximum packing or zero vulnerabilities along an arbitrary open perimeter.
- Choose **Fewest HQs → Find fewest HQs** to search for a smaller fill with **zero two-HQ loss warnings and zero open legal HQ centers inside the boundary**. Safety and coverage are hard requirements: the mode cannot apply a partial or unsafe result just to lower the count. It compares alternative patterns and coordinated rearrangements rather than simply deleting HQs. Results show the fewest HQs found by a bounded search, not a proven global minimum. A fully checked result can be used even if the search budget prevents further minimization; an incomplete terrain scan cannot qualify.
- Fewest HQs may remove HQs wholly inside the selected boundary. Removed assignments are listed before Apply; retained HQs keep their names, groups and terrain category. Enable **Keep existing HQs** to retain every current assignment and minimize only additions. HQs partly or wholly outside and all Food/Wood blockers remain fixed. Apply makes the complete change once, and Undo restores removed assignments as well as positions. If no qualifying layout is found, the plan stays unchanged.
- Choose **Exact strategy** to retain the original pattern and clearance rules, including wholly-mud footprints for the mud strategy. **Preview auto-fill** proposes additional HQs without moving existing assignments; **Apply HQ positions** adds the reviewed fill in one undoable edit. Exact previews are capped at 250 additions / 4,000 candidate centers, with lower limits for complex polygons or nearly full plans.
- Define new reusable strategies through **Manage strategies**, with integer basis vectors, terrain constraints and gaps. Clone presets, edit custom patterns, and import/export validated configurations. No executable strategy code is accepted.
- Live **HQ loss warnings** mark exposed HQs with a coral outline and `!`. Select one, or click the edge-check badge to cycle through them. **Inspect → Edge safety** shows the exact Enemy A/B footprints that both become possible if that HQ is lost. Already-open centers are listed separately and can be shown as amber dots; their count is not a count of simultaneously placeable HQs.
- Use **Find tighter placements** to compare local one-/two-tile planning adjustments and single-HQ infill. Click an option to preview it in cyan, then **Apply edge adjustment**. Suggestions must reduce the plan's total two-fit count without exposing a previously protected HQ; an infill HQ must itself pass the check. Every destination must have known, legal terrain, retain the moved HQ's all-mud/all-grass terrain category, and clear all remaining buildings. These edge exceptions allow touching spacing and may sit off the stagger plot. Names and assignments stay with moved HQs; moved members are unlinked from their preset cluster, and the plot anchor stays fixed. Undo restores the plan. A planning adjustment is not an executable in-game teleport route.
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

Tests cover offset/axial round trips, world bounds, parity, footprints, clearance, movement rules, concave wedges, reference patterns, loss-analysis witnesses, custom strategy validation, bounded filling and automatic boundary rearrangement, assignment preservation, plan storage and exports, share links, and HTTP body limits.

`GET /api/health` is a readiness endpoint. `POST /api/validate` validates a raw plan JSON body (2 MiB maximum). It is stateless and does not verify terrain or persist plans.

## Repository and deployment

GitHub: [survivormal/lastz-map-planner](https://github.com/survivormal/lastz-map-planner).

GitHub Actions checks each push and PR. The Dockerfile builds and tests the application and runs the standalone SolidStart server as a non-root user. Northflank hosts the app under **LastZ → Map Planner → lastz-map-planner**, with automatic builds and deployments from `main`. Supabase can later provide accounts and shared persistence. See [deployment instructions](docs/deployment.md).

The planner repository is separate from the research workspace. It includes only derived numeric map facts and provenance, not game source, private captures, account credentials or player datasets.
