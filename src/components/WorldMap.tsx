import { createEffect, onCleanup, onMount, createSignal } from "solid-js";
import {
  worldToPixel,
  pixelToWorld,
  hexVertices,
  footprint,
  distance,
  toAxial,
  fromAxial,
  offset,
  AXIAL_DIRECTIONS,
  inWorld,
  TILE_RADIUS,
  WORLD_SIZE,
  type Plan,
  type Tile,
  type Placement,
  type Boundary,
  type Axial,
} from "../domain";
import type { Terrain } from "../domain/schema";

export type MapTool =
  | "select"
  | "pan"
  | "hq"
  | "food"
  | "wood"
  | "boundary"
  | "erase"
  | "measure"
  | "terrain";
export type Camera = { x: number; y: number; zoom: number };
export type MapApi = {
  zoomBy: (factor: number) => void;
  focus: (tile: Tile, zoom?: number) => void;
  fitWorld: () => void;
  exportImage: () => void;
};
type Props = {
  plan: Plan;
  tool: MapTool;
  terrainAt: (tile: Tile) => Terrain;
  selectedId: string | null;
  preview: Tile[];
  previewValid: boolean;
  boundaryDraft: Tile[];
  measure: Tile[];
  riskTiles: Tile[];
  onHover: (tile: Tile | null) => void;
  onClick: (tile: Tile, placement?: Placement) => void;
  onMove: (id: string, tile: Tile) => void;
  onSelect: (id: string | null) => void;
  onMoveBoundary?: (id: string, points: Tile[]) => void;
  onEraseBoundary?: (id: string) => void;
  onCamera: (camera: Camera) => void;
  api: (api: MapApi) => void;
};
const terrainColors: Record<Terrain, string> = {
  grass: "#293e36",
  mud: "#4c4032",
  restricted: "#382e30",
  unknown: "#293334",
};
const TILE_WIDTH = Math.sqrt(3) * TILE_RADIUS;
const WORLD_WIDTH = TILE_WIDTH * (WORLD_SIZE + 0.5),
  WORLD_HEIGHT = TILE_RADIUS * (1.5 * (WORLD_SIZE - 1) + 2);
const terrainPriority: Record<Terrain, number> = {
  grass: 0,
  mud: 1,
  unknown: 2,
  restricted: 3,
};
const terrainRgb = [
  [41, 62, 54],
  [76, 64, 50],
  [41, 51, 52],
  [56, 46, 48],
];
export default function WorldMap(props: Props) {
  let canvas!: HTMLCanvasElement;
  let width = 1,
    height = 1,
    dpr = 1,
    raf = 0,
    space = false,
    mounted = false;
  const initial = worldToPixel({ x: 477, y: 477 });
  const [camera, setCamera] = createSignal<Camera>({
    x: initial.x,
    y: initial.y,
    zoom: 1.05,
  });
  let pointer: {
    id: number;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    dragged: boolean;
    placement?: Placement;
    grabOffset?: Axial;
    boundary?: Boundary;
    vertex?: number;
    startTile: Tile;
    pan: boolean;
    tool: MapTool;
  } | null = null;
  let dragTile: Tile | null = null;
  let dragBoundary: Tile[] | null = null;
  let overview: {
    lookup: Props["terrainAt"];
    step: number;
    canvas: HTMLCanvasElement;
  } | null = null;
  let overviewCells: { lookup: Props["terrainAt"]; ranks: Uint8Array } | null =
    null;
  const screenToTile = (x: number, y: number) => {
    const c = camera();
    return pixelToWorld({
      x: (x - width / 2) / c.zoom + c.x,
      y: (y - height / 2) / c.zoom + c.y,
    });
  };
  function points(tile: Tile) {
    return hexVertices(tile);
  }
  function path(
    ctx: CanvasRenderingContext2D,
    vertices: { x: number; y: number }[],
  ) {
    ctx.beginPath();
    vertices.forEach((p, i) =>
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
    );
    ctx.closePath();
  }
  const groupColor = (id: string) =>
    props.plan.groups.find((g) => g.id === id)?.color ?? "#bded9a";
  function schedule() {
    if (mounted && !raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
  }
  const minZoom = () =>
    Math.min(0.018, Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT) * 0.9);
  function updateCamera(next: Camera) {
    const zoom = Math.min(
      3,
      Math.max(minZoom(), Number.isFinite(next.zoom) ? next.zoom : 1),
    );
    // Keep some of the world reachable on screen, even while dragging past an edge.
    const marginX = Math.min(WORLD_WIDTH * 0.12, (width / zoom) * 0.4),
      marginY = Math.min(WORLD_HEIGHT * 0.12, (height / zoom) * 0.4);
    const bounded = {
      x: Math.max(-marginX, Math.min(WORLD_WIDTH + marginX, next.x)),
      y: Math.max(-marginY, Math.min(WORLD_HEIGHT + marginY, next.y)),
      zoom,
    };
    setCamera(bounded);
    props.onCamera(bounded);
    schedule();
  }
  function zoomBy(factor: number, anchor = { x: width / 2, y: height / 2 }) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const c = camera(),
      z = Math.min(3, Math.max(minZoom(), c.zoom * factor));
    updateCamera({
      x: c.x + (anchor.x - width / 2) / c.zoom - (anchor.x - width / 2) / z,
      y: c.y + (anchor.y - height / 2) / c.zoom - (anchor.y - height / 2) / z,
      zoom: z,
    });
  }
  function focus(tile: Tile, zoom = 1.05) {
    if (!inWorld(tile)) return;
    const p = worldToPixel(tile);
    updateCamera({ ...p, zoom });
  }
  function drawOverview(ctx: CanvasRenderingContext2D) {
    const step = Math.max(1, Math.ceil(2 / (camera().zoom * TILE_WIDTH)));
    if (
      !overview ||
      overview.lookup !== props.terrainAt ||
      overview.step !== step
    ) {
      if (!overviewCells || overviewCells.lookup !== props.terrainAt) {
        const ranks = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
        for (let y = 0; y < WORLD_SIZE; y++)
          for (let x = 0; x < WORLD_SIZE; x++)
            ranks[y * WORLD_SIZE + x] =
              terrainPriority[props.terrainAt({ x, y })];
        overviewCells = { lookup: props.terrainAt, ranks };
      }
      const surface = document.createElement("canvas");
      surface.width = Math.ceil(WORLD_SIZE / step);
      surface.height = Math.ceil(WORLD_SIZE / step);
      const context = surface.getContext("2d");
      if (!context) return;
      const pixels = context.createImageData(surface.width, surface.height);
      for (let by = 0; by < surface.height; by++)
        for (let bx = 0; bx < surface.width; bx++) {
          let rank = 0;
          // Aggregation is conservative: even one restricted tile marks the entire overview block.
          for (
            let y = by * step;
            y < Math.min(WORLD_SIZE, (by + 1) * step);
            y++
          )
            for (
              let x = bx * step;
              x < Math.min(WORLD_SIZE, (bx + 1) * step);
              x++
            )
              rank = Math.max(rank, overviewCells.ranks[y * WORLD_SIZE + x]);
          const index = (by * surface.width + bx) * 4,
            [r, g, b] = terrainRgb[rank];
          pixels.data[index] = r;
          pixels.data[index + 1] = g;
          pixels.data[index + 2] = b;
          pixels.data[index + 3] = 255;
        }
      context.putImageData(pixels, 0, 0);
      overview = { lookup: props.terrainAt, step, canvas: surface };
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(overview.canvas, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.restore();
    // Keep explicit user markings visible at any scale; restrictions render last.
    for (const restricted of [false, true])
      for (const tile of props.plan.terrainOverrides) {
        if ((tile.terrain === "restricted") !== restricted) continue;
        const p = worldToPixel(tile),
          c = camera();
        if (
          Math.abs(p.x - c.x) > width / c.zoom / 2 + TILE_WIDTH ||
          Math.abs(p.y - c.y) > height / c.zoom / 2 + TILE_RADIUS * 2
        )
          continue;
        ctx.fillStyle = terrainColors[tile.terrain];
        path(ctx, points(tile));
        ctx.fill();
        if (c.zoom * TILE_WIDTH < 2) {
          const size = 2 / c.zoom;
          ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        }
      }
  }
  function drawFootprint(
    ctx: CanvasRenderingContext2D,
    tile: Tile,
    color: string,
    alpha = 0.6,
    dashed = false,
  ) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4 / camera().zoom;
    if (dashed) ctx.setLineDash([3 / camera().zoom, 3 / camera().zoom]);
    for (const cell of footprint(tile)) {
      path(ctx, points(cell));
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  function draw() {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const c = camera();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#202c29";
    ctx.fillRect(0, 0, width, height);
    ctx.translate(width / 2, height / 2);
    ctx.scale(c.zoom, c.zoom);
    ctx.translate(-c.x, -c.y);
    const top = screenToTile(0, 0),
      bottom = screenToTile(width, height);
    const x0 = Math.max(0, top.x - 3),
      x1 = Math.min(999, bottom.x + 3),
      y0 = Math.max(0, top.y - 3),
      y1 = Math.min(999, bottom.y + 3);
    if (c.zoom > 0.3) {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const tile = { x, y },
            terrain = props.terrainAt(tile);
          path(ctx, points(tile));
          ctx.fillStyle = terrainColors[terrain];
          ctx.fill();
          if (props.plan.settings.showGrid) {
            ctx.strokeStyle =
              terrain === "restricted" ? "#604449" : "#52605755";
            ctx.lineWidth = 0.6 / c.zoom;
            ctx.stroke();
          }
          if (terrain === "restricted" && (x + y) % 3 === 0) {
            const p = worldToPixel(tile);
            ctx.strokeStyle = "#b7776d55";
            ctx.lineWidth = 0.8 / c.zoom;
            ctx.beginPath();
            ctx.moveTo(p.x - 5, p.y - 4);
            ctx.lineTo(p.x + 5, p.y + 4);
            ctx.stroke();
          }
        }
    } else drawOverview(ctx);
    // Exact outer envelope of the odd-row pointy-hex world, in the planner projection.
    ctx.strokeStyle = "#a9b5a16b";
    ctx.lineWidth = 2 / c.zoom;
    ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    if (props.plan.allianceAnchor) {
      const anchor = props.plan.allianceAnchor;
      const vertices = AXIAL_DIRECTIONS.map((v) =>
        worldToPixel(offset(anchor, { q: v.q * 50, r: v.r * 50 })),
      );
      path(ctx, vertices);
      ctx.strokeStyle = "#b2d68d66";
      ctx.lineWidth = 1 / c.zoom;
      ctx.setLineDash([4 / c.zoom, 6 / c.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
      const reserved =
        props.plan.allianceAnchorKind === "rally" ? [anchor] : footprint(anchor);
      for (const tile of reserved) {
        path(ctx, hexVertices(tile));
        ctx.fillStyle = "#d8e6ae22";
        ctx.fill();
        ctx.strokeStyle = "#d8e6ae99";
        ctx.stroke();
      }
      const p = worldToPixel(anchor);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 / c.zoom, 0, Math.PI * 2);
      ctx.fillStyle = "#d8e6ae";
      ctx.fill();
    }
    for (const boundary of props.plan.boundaries) {
      const vertices =
        pointer?.boundary?.id === boundary.id && dragBoundary
          ? dragBoundary
          : boundary.points;
      if (vertices.length < 2) continue;
      ctx.beginPath();
      vertices.forEach((v, i) => {
        const p = worldToPixel(v);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      if (boundary.closed) ctx.closePath();
      const selected = boundary.id === props.selectedId,
        valid = vertices.every(inWorld);
      ctx.strokeStyle = !valid ? "#f6a090" : selected ? "#eef4d0" : "#d6ceae";
      ctx.lineWidth = 2 / c.zoom;
      ctx.setLineDash([7 / c.zoom, 5 / c.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (boundary.closed) {
        ctx.fillStyle = "#d6ceae08";
        ctx.fill();
      }
      const p = worldToPixel(vertices[0]);
      label(ctx, boundary.name, p.x, p.y - 20 / c.zoom, "#eee5c6");
      if (selected && props.tool === "select")
        for (const vertex of vertices) {
          const p = worldToPixel(vertex);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5 / c.zoom, 0, Math.PI * 2);
          ctx.fillStyle = "#17231f";
          ctx.fill();
          ctx.strokeStyle = valid ? "#eef4d0" : "#f6a090";
          ctx.lineWidth = 1.5 / c.zoom;
          ctx.stroke();
        }
    }
    for (const p of props.plan.placements) {
      const tile = pointer?.placement?.id === p.id && dragTile ? dragTile : p;
      const pixel = worldToPixel(tile);
      if (
        Math.abs(pixel.x - c.x) > width / c.zoom / 2 + 80 ||
        Math.abs(pixel.y - c.y) > height / c.zoom / 2 + 80
      )
        continue;
      const color = groupColor(p.groupId);
      drawFootprint(ctx, tile, color, p.id === props.selectedId ? 0.78 : 0.52);
      const q = worldToPixel(tile);
      if (p.id === props.selectedId) {
        ctx.strokeStyle = "#f5f7dd";
        ctx.lineWidth = 2 / c.zoom;
        for (const t of footprint(tile)) {
          path(ctx, points(t));
          ctx.stroke();
        }
      }
      if (c.zoom > 0.4) {
        ctx.fillStyle = "#101e17";
        ctx.font = `600 ${Math.max(10, 12 / c.zoom)}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          p.kind === "hq" ? "HQ" : p.kind === "food" ? "F" : "W",
          q.x,
          q.y,
        );
      }
      if ((p.showGraphic || props.plan.settings.showGraphics) && c.zoom > 0.4) {
        ctx.strokeStyle = "#edf5d5";
        ctx.lineWidth = 1.5 / c.zoom;
        ctx.strokeRect(q.x - 7, q.y - 8, 14, 14);
        ctx.beginPath();
        ctx.moveTo(q.x - 10, q.y - 8);
        ctx.lineTo(q.x, q.y - 16);
        ctx.lineTo(q.x + 10, q.y - 8);
        ctx.stroke();
      }
      if (props.plan.settings.showLabels && c.zoom > 0.52)
        label(ctx, p.name || "Unassigned", q.x, q.y + 43, color);
    }
    for (const tile of props.riskTiles)
      drawFootprint(ctx, tile, "#ffad91", 0.55, true);
    if (props.preview.length)
      for (const tile of props.preview)
        drawFootprint(
          ctx,
          tile,
          props.previewValid ? "#c6f4a2" : "#f6a090",
          0.3,
          true,
        );
    const draft = props.boundaryDraft.length
      ? props.boundaryDraft
      : props.measure;
    if (draft.length) {
      ctx.beginPath();
      draft.forEach((t, i) => {
        const p = worldToPixel(t);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.strokeStyle = "#e5eab3";
      ctx.lineWidth = 2 / c.zoom;
      ctx.stroke();
      for (const t of draft) {
        const p = worldToPixel(t);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 / c.zoom, 0, Math.PI * 2);
        ctx.fillStyle = "#e5eab3";
        ctx.fill();
      }
    }
    if (props.plan.allianceAnchor) {
      const p = worldToPixel(props.plan.allianceAnchor);
      const rally = props.plan.allianceAnchorKind === "rally";
      label(
        ctx,
        rally ? "RALLY POINT" : "ALLIANCE LEADER",
        p.x,
        p.y - (rally ? TILE_RADIUS : TILE_RADIUS * 2.5) - 9 / c.zoom,
        "#d8e6ae",
      );
    }
    const palace = worldToPixel({ x: 500, y: 500 });
    if (
      Math.abs(palace.x - c.x) < width / c.zoom / 2 + 100 &&
      Math.abs(palace.y - c.y) < height / c.zoom / 2 + 100
    ) {
      ctx.strokeStyle = "#e1c99b";
      ctx.lineWidth = 2 / c.zoom;
      ctx.strokeRect(
        palace.x - 10 / c.zoom,
        palace.y - 10 / c.zoom,
        20 / c.zoom,
        20 / c.zoom,
      );
      label(
        ctx,
        "PALACE · 500, 500",
        palace.x,
        palace.y + 28 / c.zoom,
        "#e1c99b",
      );
    }
    // Corner mini-map includes the camera viewport and clickable world navigation.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { x: mx, y: my, width: mw, height: mh } = miniMap();
    ctx.fillStyle = "#14201fe8";
    ctx.fillRect(mx - 10, my - 10, mw + 20, mh + 33);
    ctx.strokeStyle = "#54615a";
    ctx.strokeRect(mx, my, mw, mh);
    ctx.fillStyle = "#46533b";
    ctx.fillRect(mx + mw * 0.45, my + mh * 0.45, mw * 0.1, mh * 0.1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(mx, my, mw, mh);
    ctx.clip();
    for (const p of props.plan.placements) {
      const pixel = worldToPixel(p);
      ctx.fillStyle = groupColor(p.groupId);
      ctx.fillRect(
        mx + (pixel.x / WORLD_WIDTH) * mw,
        my + (pixel.y / WORLD_HEIGHT) * mh,
        2,
        2,
      );
    }
    const vw = (width / c.zoom / WORLD_WIDTH) * mw,
      vh = (height / c.zoom / WORLD_HEIGHT) * mh;
    ctx.strokeStyle = "#c7e8a6";
    ctx.strokeRect(
      mx + (c.x / WORLD_WIDTH) * mw - vw / 2,
      my + (c.y / WORLD_HEIGHT) * mh - vh / 2,
      vw,
      vh,
    );
    ctx.restore();
    ctx.font = "9px system-ui";
    ctx.fillStyle = "#a3b3a7";
    ctx.textAlign = "left";
    ctx.fillText(`WORLD ${props.plan.server}`, mx, my + mh + 15);
    ctx.textAlign = "right";
    ctx.fillText("N ↑", mx + mw, my + mh + 15);
  }
  function label(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string,
  ) {
    const z = camera().zoom;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 / z, 1 / z);
    ctx.font = "500 11px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width;
    ctx.fillStyle = "#13201ee8";
    ctx.fillRect(-w / 2 - 6, -9, w + 12, 18);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  function hit(tile: Tile) {
    return props.plan.placements.find((p) => distance(p, tile) <= 1);
  }
  function local(e: PointerEvent | WheelEvent) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function miniMap() {
    return {
      x: Math.max(12, width - 146),
      y: Math.max(12, height - 146),
      width: Math.min(126, Math.max(1, width - 24)),
      height: Math.min(110, Math.max(1, height - 48)),
    };
  }
  function inMiniMap(p: { x: number; y: number }) {
    const m = miniMap();
    return (
      p.x >= m.x && p.x <= m.x + m.width && p.y >= m.y && p.y <= m.y + m.height
    );
  }
  function screenPoint(tile: Tile) {
    const p = worldToPixel(tile),
      c = camera();
    return {
      x: (p.x - c.x) * c.zoom + width / 2,
      y: (p.y - c.y) * c.zoom + height / 2,
    };
  }
  function boundaryHit(
    p: { x: number; y: number },
    verticesOnly = false,
  ): { boundary: Boundary; vertex?: number } | undefined {
    const boundaries = [...props.plan.boundaries].sort(
      (a, b) =>
        Number(b.id === props.selectedId) - Number(a.id === props.selectedId),
    );
    for (const boundary of boundaries) {
      if (boundary.id === props.selectedId) {
        const vertex = boundary.points.findIndex((tile) => {
          const q = screenPoint(tile);
          return Math.hypot(p.x - q.x, p.y - q.y) <= 9;
        });
        if (vertex !== -1) return { boundary, vertex };
      }
      if (verticesOnly) continue;
      const count = boundary.closed
        ? boundary.points.length
        : boundary.points.length - 1;
      for (let i = 0; i < count; i++) {
        const a = screenPoint(boundary.points[i]),
          b = screenPoint(boundary.points[(i + 1) % boundary.points.length]),
          dx = b.x - a.x,
          dy = b.y - a.y;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
          ),
        );
        if (Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= 7)
          return { boundary };
      }
    }
  }
  function hoverAt(p: { x: number; y: number }) {
    const tile = screenToTile(p.x, p.y);
    props.onHover(
      p.x < 0 ||
        p.y < 0 ||
        p.x > width ||
        p.y > height ||
        inMiniMap(p) ||
        !inWorld(tile)
        ? null
        : tile,
    );
  }
  function cancelPointer() {
    const id = pointer?.id;
    pointer = null;
    dragTile = null;
    dragBoundary = null;
    if (id !== undefined && canvas.hasPointerCapture(id))
      canvas.releasePointerCapture(id);
    schedule();
  }
  function down(e: PointerEvent) {
    if (pointer || e.button > 1) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    const p = local(e);
    if (inMiniMap(p)) {
      const m = miniMap();
      const tile = pixelToWorld({
        x: ((p.x - m.x) / m.width) * WORLD_WIDTH,
        y: ((p.y - m.y) / m.height) * WORLD_HEIGHT,
      });
      focus(
        {
          x: Math.max(0, Math.min(999, tile.x)),
          y: Math.max(0, Math.min(999, tile.y)),
        },
        camera().zoom,
      );
      props.onHover(null);
      return;
    }
    const tile = screenToTile(p.x, p.y),
      placement = hit(tile),
      boundary =
        boundaryHit(p, true) ?? (!placement ? boundaryHit(p) : undefined);
    const pan =
      props.tool === "pan" ||
      space ||
      e.button === 1 ||
      (props.tool === "select" && !placement && !boundary);
    const movable = props.tool === "select" && !pan;
    const grab = toAxial(tile),
      origin = placement ? toAxial(placement) : grab;
    pointer = {
      id: e.pointerId,
      x: p.x,
      y: p.y,
      lastX: p.x,
      lastY: p.y,
      dragged: false,
      startTile: tile,
      tool: props.tool,
      pan,
      placement: movable && !boundary ? placement : undefined,
      grabOffset: { q: grab.q - origin.q, r: grab.r - origin.r },
      boundary: movable ? boundary?.boundary : undefined,
      vertex: boundary?.vertex,
    };
    if (movable && boundary) props.onSelect(boundary.boundary.id);
    canvas.setPointerCapture(e.pointerId);
  }
  function updateDrag(p: { x: number; y: number }) {
    if (!pointer) return;
    const tile = screenToTile(p.x, p.y);
    if (pointer.placement) {
      const a = toAxial(tile),
        grab = pointer.grabOffset!;
      dragTile = fromAxial({ q: a.q - grab.q, r: a.r - grab.r });
    } else if (pointer.boundary) {
      const from = toAxial(pointer.startTile),
        to = toAxial(tile),
        delta = { q: to.q - from.q, r: to.r - from.r };
      dragBoundary = pointer.boundary.points.map((vertex, index) =>
        pointer!.vertex === undefined || index === pointer!.vertex
          ? offset(vertex, delta)
          : vertex,
      );
    }
  }
  function move(e: PointerEvent) {
    const p = local(e);
    if (pointer && pointer.id !== e.pointerId) return;
    if (pointer) {
      if (Math.hypot(p.x - pointer.x, p.y - pointer.y) > 4)
        pointer.dragged = true;
      if (pointer.dragged) {
        if (pointer.pan) {
          const c = camera();
          updateCamera({
            ...c,
            x: c.x - (p.x - pointer.lastX) / c.zoom,
            y: c.y - (p.y - pointer.lastY) / c.zoom,
          });
        } else updateDrag(p);
      }
      pointer.lastX = p.x;
      pointer.lastY = p.y;
    }
    hoverAt(p);
    schedule();
  }
  function up(e: PointerEvent) {
    if (!pointer || pointer.id !== e.pointerId) return;
    const p = local(e),
      tile = screenToTile(p.x, p.y),
      state = pointer;
    if (state.dragged && !state.pan) updateDrag(p);
    const movedTile = dragTile,
      movedBoundary = dragBoundary;
    cancelPointer();
    if (state.dragged) {
      if (
        state.placement &&
        movedTile &&
        (state.placement.x !== movedTile.x || state.placement.y !== movedTile.y)
      )
        props.onMove(state.placement.id, movedTile);
      else if (
        state.boundary &&
        movedBoundary &&
        movedBoundary.every(inWorld) &&
        movedBoundary.some(
          (v, i) =>
            v.x !== state.boundary!.points[i].x ||
            v.y !== state.boundary!.points[i].y,
        )
      )
        props.onMoveBoundary?.(state.boundary.id, movedBoundary);
    } else if (!space && e.button !== 1) {
      const placement = hit(tile),
        boundary =
          boundaryHit(p, true) ?? (!placement ? boundaryHit(p) : undefined);
      if (props.tool === "select" && boundary)
        props.onSelect(boundary.boundary.id);
      else if (props.tool === "erase" && boundary)
        props.onEraseBoundary?.(boundary.boundary.id);
      else props.onClick(tile, placement);
    }
    hoverAt(p);
    schedule();
  }
  onMount(() => {
    mounted = true;
    const ro = new ResizeObserver((entries) => {
      width = Math.max(1, entries[0].contentRect.width);
      height = Math.max(1, entries[0].contentRect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      schedule();
    });
    ro.observe(canvas);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e),
        delta =
          e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1);
      zoomBy(Math.exp(-delta * 0.0015), p);
      if (pointer && !pointer.pan) updateDrag(p);
      hoverAt(p);
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    const keyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelPointer();
      if (e.target !== canvas) return;
      if (e.code === "Space") {
        space = true;
        e.preventDefault();
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(1.2);
      } else if (e.key === "-") {
        e.preventDefault();
        zoomBy(1 / 1.2);
      }
      const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0,
        dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (dx || dy) {
        e.preventDefault();
        const c = camera();
        updateCamera({
          ...c,
          x: c.x + (dx * 64) / c.zoom,
          y: c.y + (dy * 64) / c.zoom,
        });
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") space = false;
    };
    const blur = () => {
      space = false;
      cancelPointer();
      props.onHover(null);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    props.api({
      zoomBy,
      focus,
      fitWorld: () =>
        updateCamera({
          x: WORLD_WIDTH / 2,
          y: WORLD_HEIGHT / 2,
          zoom: Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT) * 0.9,
        }),
      exportImage: () => {
        draw();
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = "lastz-plan.png";
        a.click();
      },
    });
    props.onCamera(camera());
    schedule();
    onCleanup(() => {
      mounted = false;
      ro.disconnect();
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
      cancelAnimationFrame(raf);
      overview = null;
      overviewCells = null;
    });
  });
  createEffect(() => {
    props.plan;
    props.tool;
    props.selectedId;
    props.preview;
    props.previewValid;
    props.boundaryDraft;
    props.measure;
    props.riskTiles;
    props.terrainAt;
    if (pointer && pointer.tool !== props.tool) cancelPointer();
    schedule();
  });
  return (
    <canvas
      ref={canvas}
      class={`world-canvas tool-${props.tool}`}
      tabIndex={0}
      aria-label="World map. Select a tool then click a tile. Drag to pan; scroll to zoom. Arrow keys pan and plus or minus zoom. Select a boundary to drag its line or vertex handles. Coordinates can also be entered in the inspector."
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancelPointer}
      onLostPointerCapture={() => {
        if (pointer) cancelPointer();
      }}
      onPointerLeave={() => {
        if (!pointer) props.onHover(null);
      }}
    />
  );
}
