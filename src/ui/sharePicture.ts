import type { Session } from '../engine';
import { renderCardBlob } from './cardDraw';
import { buildCardModel } from './cardModel';
import { loadCardPhotos } from './cardPhotos';
import { deliverPicture, type PictureOutcome } from './cardShare';

/** Draws the session as a picture and hands it to the share sheet or a download. Throws when the picture cannot be made. */
export async function sharePictureFor(session: Session, opts: { results: boolean; theme?: string }): Promise<PictureOutcome> {
  const model = buildCardModel(session, { results: opts.results, theme: opts.theme });
  const photos = await loadCardPhotos(model.players.flatMap((p) => (p.rosterId ? [p.rosterId] : [])));
  return deliverPicture(await renderCardBlob(model, photos), session.name);
}
