import { initials } from './Avatar';
import { CARD_HEIGHT, CARD_WIDTH, gridColumns, type CardModel, type Palette } from './cardModel';

/** The part of a canvas context the card uses. A stub with these members is enough for a test. */
export type DrawingContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'fillRect'
  | 'fillText'
  | 'beginPath'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'save'
  | 'restore'
  | 'clip'
  | 'drawImage'
  | 'measureText'
>;

/** Photos already decoded, by saved-player id. A player without one is drawn with initials. */
export type CardPhotos = Map<string, ImageBitmap>;

const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MARGIN = 72;
const CONTENT_WIDTH = CARD_WIDTH - MARGIN * 2;
const FOOTER_TOP = CARD_HEIGHT - 110;

/** The text, cut with an ellipsis if it is wider than `maxWidth` at the current font. */
function fit(ctx: DrawingContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function write(ctx: DrawingContext, text: string, x: number, y: number, size: number, weight: number, color: string, align: CanvasTextAlign = 'left') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

/** The title shrinks a little before it is cut, so most names stay whole. */
function drawTitle(ctx: DrawingContext, title: string, palette: Palette, y: number) {
  let size = 72;
  ctx.font = `800 ${size}px ${FONT}`;
  while (size > 44 && ctx.measureText(title).width > CONTENT_WIDTH) {
    size -= 4;
    ctx.font = `800 ${size}px ${FONT}`;
  }
  write(ctx, fit(ctx, title, CONTENT_WIDTH), MARGIN, y, size, 800, palette.ink);
}

function drawAvatar(ctx: DrawingContext, cx: number, cy: number, r: number, name: string, photo: ImageBitmap | undefined, palette: Palette) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (photo) {
    const side = Math.min(photo.width, photo.height);
    ctx.drawImage(photo, (photo.width - side) / 2, (photo.height - side) / 2, side, side, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = palette.accent;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
  if (!photo) write(ctx, initials(name), cx, cy + r * 0.22, Math.round(r * 0.7), 800, palette.accentInk, 'center');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3;
  ctx.stroke();
}

export interface GridLayout {
  cols: number;
  top: number;
  cellW: number;
  cellH: number;
  /** Avatar radius. */
  radius: number;
  /** Font size for the name and the games under each avatar. */
  small: number;
}

/** Room for the avatar, the name and the count in every cell, so rows never touch. */
export function gridLayout(count: number, top: number): GridLayout {
  const cols = gridColumns(count);
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = CONTENT_WIDTH / cols;
  const cellH = Math.min(cellW * 1.6, (FOOTER_TOP - top) / rows);
  const small = Math.max(20, Math.round(Math.min(cellW, cellH) * 0.17));
  const radius = Math.min(cellW * 0.34, (cellH - small * 2 - 24) / 2);
  return { cols, top, cellW, cellH, radius, small };
}

/** Draws the whole card. Pure drawing: no network, no storage, nothing global. */
export function drawCard(ctx: DrawingContext, model: CardModel, photos: CardPhotos): void {
  const { palette } = model;
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = palette.accent;
  ctx.fillRect(0, 0, CARD_WIDTH, 28);

  drawTitle(ctx, model.title, palette, 170);
  write(ctx, `${model.date} · ${model.facts}`, MARGIN, 236, 38, 500, palette.muted);

  let top = 300;
  for (const line of model.lines) {
    top += 60;
    ctx.beginPath();
    ctx.arc(MARGIN + 12, top - 14, 11, 0, Math.PI * 2);
    ctx.fillStyle = palette.accent;
    ctx.fill();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = `600 40px ${FONT}`;
    write(ctx, fit(ctx, line, CONTENT_WIDTH - 44), MARGIN + 44, top, 40, 600, palette.ink);
  }
  if (model.lines.length > 0) top += 40;

  const grid = gridLayout(model.players.length, top + 20);
  const { cols, cellW, cellH, radius, small } = grid;
  const gridTop = grid.top;
  model.players.forEach((p, i) => {
    const cx = MARGIN + (i % cols) * cellW + cellW / 2;
    const cellTop = gridTop + Math.floor(i / cols) * cellH;
    drawAvatar(ctx, cx, cellTop + radius, radius, p.name, p.rosterId ? photos.get(p.rosterId) : undefined, palette);
    ctx.font = `600 ${small}px ${FONT}`;
    write(ctx, fit(ctx, p.name, cellW - 12), cx, cellTop + radius * 2 + small + 8, small, 600, palette.ink, 'center');
    const count = p.record ? `${p.games} · ${p.record}` : `${p.games}`;
    write(ctx, count, cx, cellTop + radius * 2 + small * 2 + 12, small, 800, palette.muted, 'center');
  });

  if (model.more > 0) write(ctx, `+${model.more} more`, MARGIN, CARD_HEIGHT - 52, 32, 600, palette.muted);
  write(ctx, 'PIKLMatch', CARD_WIDTH - MARGIN, CARD_HEIGHT - 52, 32, 800, palette.muted, 'right');
}

/** A 1080 by 1350 PNG of the card. Rejects when the browser has no canvas or cannot encode the picture. */
export function renderCardBlob(model: CardModel, photos: CardPhotos): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('This browser has no canvas to draw on.'));
  drawCard(ctx, model, photos);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not make the picture.'))), 'image/png');
  });
}
