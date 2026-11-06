import { worldToPixel, type Pixel } from "../domain/geometry";
import profile from "../data/world-profile.json";

type LandmarkView = {
  camera: { x: number; y: number; zoom: number };
  width: number;
  height: number;
};
type LabelBounds = { left: number; top: number; right: number; bottom: number };

const LANDMARK_IDS = new Set([1, 101, 102, 103]);
const landmarks = profile.cities
  .filter((city) => LANDMARK_IDS.has(city.id))
  .map((city) => ({
    ...city,
    pixel: worldToPixel(city),
    capital: city.id === profile.capital.id,
    label:
      city.id === profile.capital.id
        ? `Capital · ${city.x}, ${city.y}`
        : `Turret ${city.id - 100}`,
  }));

function polygon(
  ctx: CanvasRenderingContext2D,
  vertices: readonly (readonly [number, number])[],
  fill: string,
) {
  ctx.beginPath();
  vertices.forEach(([x, y], i) =>
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y),
  );
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

/** Original architectural pictogram, not a game model or a placement footprint. */
function capitalIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#373a2f35";
  ctx.beginPath();
  ctx.ellipse(2, 24, 32, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#585b57";
  ctx.lineWidth = 1.2;
  polygon(
    ctx,
    [
      [-31, 15],
      [0, 6],
      [31, 15],
      [0, 27],
    ],
    "#b3b6b0",
  );
  polygon(
    ctx,
    [
      [-28, 15],
      [-28, -8],
      [0, -17],
      [0, 23],
    ],
    "#d7d9d3",
  );
  polygon(
    ctx,
    [
      [0, -17],
      [28, -8],
      [28, 15],
      [0, 23],
    ],
    "#a9aea9",
  );
  polygon(
    ctx,
    [
      [-31, -9],
      [0, -21],
      [31, -9],
      [0, 3],
    ],
    "#f1f1e9",
  );
  polygon(
    ctx,
    [
      [-10, -12],
      [-10, -26],
      [0, -31],
      [0, -8],
    ],
    "#e7e9e3",
  );
  polygon(
    ctx,
    [
      [0, -31],
      [10, -26],
      [10, -12],
      [0, -8],
    ],
    "#bcc2bd",
  );
  polygon(
    ctx,
    [
      [-13, -26],
      [0, -33],
      [13, -26],
      [0, -20],
    ],
    "#faf9ef",
  );
  ctx.fillStyle = "#707a76";
  ctx.fillRect(-18, 1, 4, 9);
  ctx.fillRect(-9, 4, 4, 9);
  ctx.fillRect(7, 4, 4, 9);
  ctx.fillRect(16, 1, 4, 9);
  ctx.strokeStyle = "#eef0e5";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-27, 16);
  ctx.lineTo(0, 24);
  ctx.lineTo(27, 16);
  ctx.stroke();
}

/** Small neutral cannon glyph; it conveys the landmark without copying its artwork. */
function turretIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#373a2f35";
  ctx.beginPath();
  ctx.ellipse(1, 13, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#5d6662";
  ctx.lineWidth = 1.1;
  polygon(
    ctx,
    [
      [-12, 8],
      [0, 3],
      [12, 8],
      [12, 13],
      [0, 17],
      [-12, 13],
    ],
    "#b8c0b9",
  );
  polygon(
    ctx,
    [
      [-8, 7],
      [-8, -4],
      [0, -8],
      [8, -4],
      [8, 7],
      [0, 11],
    ],
    "#dfe4dc",
  );
  polygon(
    ctx,
    [
      [0, -8],
      [8, -4],
      [8, 7],
      [0, 11],
    ],
    "#a5afa8",
  );
  polygon(
    ctx,
    [
      [-12, -8],
      [-5, -16],
      [7, -13],
      [12, -5],
      [3, 1],
      [-9, -2],
    ],
    "#ecefe6",
  );
  polygon(
    ctx,
    [
      [-2, -10],
      [1, -15],
      [18, -8],
      [16, -3],
    ],
    "#d4dcd4",
  );
  ctx.strokeStyle = "#f8f8ef";
  ctx.beginPath();
  ctx.moveTo(1, -13);
  ctx.lineTo(16, -7);
  ctx.stroke();
  ctx.strokeStyle = "#68756e";
  ctx.beginPath();
  ctx.moveTo(17, -7);
  ctx.lineTo(16, -4);
  ctx.stroke();
}

function compactMarker(ctx: CanvasRenderingContext2D, capital: boolean) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#463f2c";
  ctx.fillStyle = capital ? "#fff1c4" : "#edf1e7";
  if (capital) {
    polygon(
      ctx,
      [
        [0, -4],
        [4, 0],
        [0, 4],
        [-4, 0],
      ],
      "#fff1c4",
    );
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function intersects(a: LabelBounds, b: LabelBounds): boolean {
  return (
    a.left < b.right + 4 &&
    a.right > b.left - 4 &&
    a.top < b.bottom + 4 &&
    a.bottom > b.top - 4
  );
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  screen: Pixel,
  iconRadius: number,
  view: LandmarkView,
  occupied: LabelBounds[],
) {
  const z = view.camera.zoom;
  ctx.save();
  ctx.scale(1 / z, 1 / z);
  ctx.font = "600 11px system-ui, sans-serif";
  const halfWidth = ctx.measureText(text).width / 2 + 11;
  // Prefer below the icon; move above it if another landmark label occupies that space.
  for (const direction of [1, -1]) {
    const y = direction * (iconRadius * z + 16);
    const bounds = {
      left: screen.x - halfWidth,
      right: screen.x + halfWidth,
      top: screen.y + y - 11,
      bottom: screen.y + y + 11,
    };
    if (
      bounds.right < 0 ||
      bounds.left > view.width ||
      bounds.bottom < 0 ||
      bounds.top > view.height ||
      occupied.some((other) => intersects(bounds, other))
    )
      continue;
    occupied.push(bounds);
    ctx.translate(0, y);
    ctx.strokeStyle = "#b29556";
    ctx.lineWidth = 1;
    polygon(
      ctx,
      [
        [-halfWidth + 6, -10],
        [halfWidth - 6, -10],
        [halfWidth, 0],
        [halfWidth - 6, 10],
        [-halfWidth + 6, 10],
        [-halfWidth, 0],
      ],
      "#302b22e8",
    );
    ctx.fillStyle = "#fff8e6";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 0.5);
    break;
  }
  ctx.restore();
}

/**
 * Draw with the caller's world/camera transform already applied, before plan placements.
 * All anchors come from the verified static profile. Artwork never changes map legality.
 */
export function drawGameLandmarks(
  ctx: CanvasRenderingContext2D,
  view: LandmarkView,
): void {
  const { camera, width, height } = view;
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) return;
  const occupied: LabelBounds[] = [];
  for (const landmark of landmarks) {
    const screen = {
      x: (landmark.pixel.x - camera.x) * camera.zoom + width / 2,
      y: (landmark.pixel.y - camera.y) * camera.zoom + height / 2,
    };
    const radius = landmark.capital ? 33 : 18;
    const margin = radius * camera.zoom + 90;
    if (
      screen.x < -margin ||
      screen.x > width + margin ||
      screen.y < -margin ||
      screen.y > height + margin
    )
      continue;
    ctx.save();
    ctx.translate(landmark.pixel.x, landmark.pixel.y);
    ctx.setLineDash([]);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (camera.zoom < 0.18) {
      ctx.scale(1 / camera.zoom, 1 / camera.zoom);
      compactMarker(ctx, landmark.capital);
    } else {
      if (landmark.capital) capitalIcon(ctx);
      else turretIcon(ctx);
      drawLabel(ctx, landmark.label, screen, radius, view, occupied);
    }
    ctx.restore();
  }
}
