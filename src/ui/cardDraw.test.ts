import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, paletteFor, type CardModel, type CardPlayer } from './cardModel';
import { drawCard, gridLayout, renderCardBlob, type DrawingContext } from './cardDraw';

interface Call {
  op: string;
  args: unknown[];
  fill?: unknown;
}

/** A canvas context that only writes down what it was asked to do. Text is 10 px wide per letter. */
function recorder() {
  const calls: Call[] = [];
  const state = { fillStyle: '' as unknown, strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic' };
  const note =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args, fill: state.fillStyle });
    };
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 10 });
      if (key in target) return target[key as keyof typeof target];
      return note(key);
    },
    set(target, key: string, value) {
      (target as Record<string, unknown>)[key] = value;
      return true;
    },
  }) as unknown as DrawingContext;
  return { ctx, calls };
}

const texts = (calls: Call[]) => calls.filter((c) => c.op === 'fillText').map((c) => c.args[0] as string);

function model(players: CardPlayer[], over: Partial<CardModel> = {}): CardModel {
  return {
    title: 'Wednesday open play',
    date: 'Wed 4 Nov',
    facts: '12 games · 3h 5m',
    lines: ['Most games: Ann, 6', 'Longest game: 25m'],
    players,
    more: 0,
    palette: paletteFor('light'),
    ...over,
  };
}

const ann: CardPlayer = { name: 'Ann Lee', games: 6 };
const ben: CardPlayer = { name: 'Ben', games: 5, record: '4W 1L', rosterId: 'r-ben' };

describe('drawCard', () => {
  it('paints the whole card in the theme colour, then writes the name, day, facts and highlights', () => {
    const { ctx, calls } = recorder();
    drawCard(ctx, model([ann, ben]), new Map());
    const first = calls.find((c) => c.op === 'fillRect')!;
    expect(first.args).toEqual([0, 0, CARD_WIDTH, CARD_HEIGHT]);
    expect(first.fill).toBe('#fafaf7');
    const written = texts(calls);
    expect(written).toContain('Wednesday open play');
    expect(written).toContain('Wed 4 Nov · 12 games · 3h 5m');
    expect(written).toContain('Most games: Ann, 6');
    expect(written).toContain('Longest game: 25m');
  });

  it('uses the dark colours for a dark card', () => {
    const { ctx, calls } = recorder();
    drawCard(ctx, model([ann], { palette: paletteFor('dark') }), new Map());
    expect(calls.find((c) => c.op === 'fillRect')!.fill).toBe('#0f0f0e');
  });

  it('writes each player with their games, and a record only when the model has one', () => {
    const { ctx, calls } = recorder();
    drawCard(ctx, model([ann, ben]), new Map());
    const written = texts(calls);
    expect(written).toContain('Ann Lee');
    expect(written).toContain('6');
    expect(written).toContain('Ben');
    expect(written).toContain('5 · 4W 1L');
    expect(written.filter((t) => t.includes('W '))).toEqual(['5 · 4W 1L']);
  });

  it('shows initials without a photo and the photo, cropped square from the middle, with one', () => {
    const { ctx, calls } = recorder();
    const photo = { width: 400, height: 200 } as ImageBitmap;
    drawCard(ctx, model([ann, ben]), new Map([['r-ben', photo]]));
    expect(texts(calls)).toContain('AL');
    expect(texts(calls)).not.toContain('BE');
    const draw = calls.filter((c) => c.op === 'drawImage');
    expect(draw).toHaveLength(1);
    expect(draw[0].args.slice(0, 5)).toEqual([photo, 100, 0, 200, 200]);
  });

  it('cuts a long name to fit its cell, and says how many more there were', () => {
    const { ctx, calls } = recorder();
    drawCard(ctx, model([{ name: 'Maximilian Featherstonehaugh-Cholmondeley', games: 2 }], { more: 4 }), new Map());
    const written = texts(calls);
    expect(written.some((t) => t.endsWith('…'))).toBe(true);
    expect(written).toContain('+4 more');
  });

  it('keeps every line of text inside the card, even with a full grid and no highlights', () => {
    const many = Array.from({ length: 30 }, (_, i): CardPlayer => ({ name: `Player ${i}`, games: i }));
    for (const lines of [[], ['a', 'b', 'c']]) {
      const { ctx, calls } = recorder();
      drawCard(ctx, model(many, { lines, more: 3 }), new Map());
      for (const c of calls.filter((x) => x.op === 'fillText')) {
        const [, x, y] = c.args as [string, number, number];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(CARD_WIDTH);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(CARD_HEIGHT);
      }
    }
  });
});

describe('gridLayout', () => {
  it('gives every cell room for the avatar, the name and the count, for any group size and number of highlights', () => {
    for (let count = 1; count <= 30; count++) {
      for (const lines of [0, 1, 2, 3]) {
        const top = 300 + lines * 60 + (lines ? 40 : 0) + 20;
        const g = gridLayout(count, top);
        expect(g.radius).toBeGreaterThan(20);
        expect(g.radius * 2 + g.small * 2 + 12).toBeLessThanOrEqual(g.cellH);
        expect(g.top + Math.ceil(count / g.cols) * g.cellH).toBeLessThanOrEqual(1240 + 0.001);
      }
    }
  });
});

describe('renderCardBlob', () => {
  afterEach(() => vi.restoreAllMocks());

  it('makes a 1080 by 1350 PNG', async () => {
    const { ctx, calls } = recorder();
    const sizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      sizes.push([this.width, this.height]);
      return ctx as unknown as CanvasRenderingContext2D;
    });
    const png = new Blob(['x'], { type: 'image/png' });
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb, type) => {
      expect(type).toBe('image/png');
      cb(png);
    });
    await expect(renderCardBlob(model([ann]), new Map())).resolves.toBe(png);
    expect(sizes).toEqual([[1080, 1350]]);
    expect(toBlob).toHaveBeenCalledTimes(1);
    expect(texts(calls)).toContain('Wednesday open play');
  });

  it('fails clearly when the browser has no canvas or cannot make the picture', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(renderCardBlob(model([ann]), new Map())).rejects.toThrow(/canvas/i);
    const { ctx } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null));
    await expect(renderCardBlob(model([ann]), new Map())).rejects.toThrow(/picture/i);
  });
});
