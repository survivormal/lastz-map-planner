# Map geometry and evidence

Reviewed November 5, 2026 against offline client sources, the installed APK, cached configuration last modified November 4, and the November 3 SVS screenshot studies. These establish a dated normal-world static baseline. Current server 802 season, event state and occupancy remain unverified. The bundled `src/data/world-profile.json` records evidence status and source hashes. No private player data or raw game code is included in this project.

## Supported facts

| Fact | Evidence |
| --- | --- |
| 1000×1000 world; X/Y 0–999 | Client `ConstDefine` constants |
| Pointy hexagons, odd-row offset grid; X east, Y south | Client `Hex` conversion and existing screenshot checks |
| Point ID = 1 + X + 1000×Y | Client `TileCoordWorld` conversion |
| Capital at X500 Y500 | Runtime `worldcity` row 1 |
| HQ occupies seven tiles | Cached `worldmap_city.k12=3`; radius `floor(k12/2)=1` |
| Alliance Food and Wood occupy seven tiles | Runtime `alliance_res_build` size 3, converted to hex radius 1 by `WorldAllianceBuildUtil` |
| Food/Wood must stay entirely off mud | Client validates every occupied tile and rejects black land |
| Actual HQ teleport must clear its original footprint | Client `WorldBuildUtil` move-city validation |

Offset to axial: `q=x-floor(y/2), r=y`; inverse: `x=q+floor(r/2), y=r`. Hex distance is `max(abs(dq),abs(dr),abs(dq+dr))`. The radius-one footprint contains the center and six neighboring hexagons.

Native ground projection uses radius 1.1547 and stored sqrt(3) 1.7320508. Center coordinates are `X=R×sqrt3×(x+0.5×(y&1)+0.5)` and `Z=-R×(1.5×y+1)`. The planner uses an orthographic representation of this topology. Matching game screenshots pixel-for-pixel additionally requires matching camera projection, zoom, viewport and art.

## Cached terrain baseline

The current mapped Android filesystem was read directly through QCOW2 and ext4, without mounting it, contacting the game, or executing guest commands. Its `data_config.txt` has mtime `2026-11-04T15:43:01Z`. Selected values independently confirm the previously inferred dimensions:

- `wonder_rocky_ground.k4=35`: outer mud radius 35.
- `NPC_city_range.k1=35`: capital exclusion `ceil(35/2)-1=17`; mud excludes `floor(35/2)=17`.
- `NPC_city_range.k3=7`: other city exclusion radius 3. All 90 world-city locations match four current cached table variants.
- `alliance_gather_config.k1=100`: every Food/Wood footprint tile must stay within radius `ceil((100-1)/2)=50` of the applicable alliance marker/leader. Marker location and occupancy are not included.

The installed `main_scenes` bundle matches the archived APK byte-for-byte (hash recorded in the profile). `WorldBlockIndex_S0` contains 125,000 bytes representing 43,279 blocked cells. `static-blocks-s0.json` stores only derived numeric runs. The decoder is checked by reconstructing the original bitset and matching its SHA-256. Client Lua and native disassembly confirm LSB-first bit order and indexing by the one-based point ID itself. The client skips the last point ID through its `<1000000` guard; the derived mask preserves that behavior.

`staticTerrainAt` combines this obstacle mask with the city exclusions and mud rule. Static water/rock distinctions cannot be recovered from a boolean passability bit and are represented as restricted. The baseline applies to normal-world S0: the client selects it when world season is zero or the seasonal map is closed. Active world season N selects S(N+1). Unsupported scenarios return unknown. Being classified in this cached baseline does not certify current server legality; current season/event selection and dynamic occupancy are separate evidence requirements.

March timing still requires supplied paths and speed modifiers; tile distance alone is not a verified ETA. Matching game screenshots pixel-for-pixel still requires camera calibration. User terrain edits remain calibration rather than independent game evidence.

## Strategies and single-loss analysis

Default, tight and loose mean zero, one and two empty tiles between seven-tile footprints, respectively. This results in minimum center distances of 3, 4 and 5.

The mud stagger lattice has basis `(3,1),(-1,4)`, area 13 tiles per HQ and minimum center distance 4. In a complete periodic interior, removing one HQ enables seven replacement centers and every pair overlaps: at most one equal-size replacement fits. This proof assumes all surrounding HQs remain present. It does not certify edges, missing neighbors, terrain exclusions, pre-existing gaps or multiple losses.

The grass wide stagger uses `(3,2),(-2,5)`, area 19 and minimum center distance 5. It provides the requested two-tile clearance; it carries no one-loss protection guarantee.

Smart fill enumerates a bounded lattice from an explicit anchor and checks full footprint containment, terrain, overlap and the strategy's minimum gap. It reports rejected candidates and truncation. It proposes valid placements under the chosen model; it does not promise globally optimal packing or single-loss safety. Analyze the completed plan to inspect concrete two-HQ replacement witnesses.

Custom strategies use a versioned JSON schema, integer axial basis vectors, a minimum gap from 0–10, a terrain constraint and 60-degree rotation steps. Imported configurations cannot replace reserved built-in strategy IDs or execute code. Custom definitions persist inside plan files.

## Source provenance

The original research workspace contains `Hex.lua`, `TileCoordWorld.lua`, `ConstDefine.lua`, `WorldBuildUtil.lua`, `WorldAllianceBuildUtil.lua`, runtime `worldcity` and `alliance_res_build` tables and English localization. The bundled profile gives their relative evidence paths and SHA-256 hashes for reproducibility without redistributing those files.

Screenshot and lattice evidence: `output/svs-checkerboard-20261103/new-map-grid-calibration.json`, `optimal-mud-spacing-verification.json`, and `verify_optimal_spacing.py` in the original research workspace. The full investigation is recorded there in `output/map-planner-evidence.md`.
