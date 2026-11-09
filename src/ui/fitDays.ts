/** How many compaction steps there are after the full-size card. */
export const MAX_FIT = 3;

/**
 * True when something in the card is lower than the card's own content area, so its bottom edge is clipped. Only the
 * card's real content counts: the faint court lines are positioned out of the flow and stick out on purpose.
 */
function clipped(card: HTMLElement): boolean {
  const box = card.getBoundingClientRect();
  const limit = box.bottom - (parseFloat(getComputedStyle(card).paddingBottom) || 0) + 1;
  return [...card.children].some((c) => !(c instanceof SVGElement) && c.getBoundingClientRect().bottom > limit);
}

/**
 * Compacts the day cards a step at a time until none of them is clipped, so Home fits the screen without scrolling and
 * the Start button is never pushed below it. The step is written on the track as data-fit, and the stylesheet shrinks
 * spacing at 1, drops the last-session stats at 2, and drops the court bar at 3. Every card gets the same step, so
 * swiping between days does not change the layout. Returns the step it settled on.
 */
export function fitDays(track: HTMLElement): number {
  const cards = [...track.querySelectorAll<HTMLElement>('.home-hero')];
  for (let step = 0; step <= MAX_FIT; step++) {
    track.dataset.fit = String(step);
    if (!cards.some(clipped)) return step;
  }
  return MAX_FIT;
}
