import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { usePhotoUrl } from './usePhotoUrl';

const jpeg = (n: number) => ({ type: 'image/jpeg', data: new Uint8Array([n]).buffer });

beforeEach(async () => {
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false, persistent: true });
});
afterEach(() => vi.restoreAllMocks());

describe('usePhotoUrl', () => {
  it('has no url without a roster id or without a photo', async () => {
    const ann = await useRosterStore.getState().add('Ann');
    const noId = renderHook(() => usePhotoUrl(undefined));
    const noPhoto = renderHook(() => usePhotoUrl(ann.id));
    await act(async () => {}); // let any late load settle before checking
    expect(noId.result.current).toBeUndefined();
    expect(noPhoto.result.current).toBeUndefined();
  });

  it('gives an object url once a photo exists, and drops it when the photo is removed', async () => {
    const ann = await useRosterStore.getState().add('Ann');
    await useRosterStore.getState().setPhoto(ann.id, jpeg(1));
    const { result } = renderHook(() => usePhotoUrl(ann.id));
    await waitFor(() => expect(result.current).toMatch(/^blob:/));
    await act(() => useRosterStore.getState().removePhoto(ann.id));
    await waitFor(() => expect(result.current).toBeUndefined());
  });

  it('loads the new picture and frees the old url when the photo is replaced', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const ann = await useRosterStore.getState().add('Ann');
    await useRosterStore.getState().setPhoto(ann.id, jpeg(1));
    const { result } = renderHook(() => usePhotoUrl(ann.id));
    await waitFor(() => expect(result.current).toBeDefined());
    const first = result.current;
    await act(() => useRosterStore.getState().setPhoto(ann.id, jpeg(2)));
    await waitFor(() => expect(result.current).not.toBe(first));
    expect(revoke).toHaveBeenCalledWith(first);
  });

  it('never returns a removed photo, not even for one render', async () => {
    const ann = await useRosterStore.getState().add('Ann');
    await useRosterStore.getState().setPhoto(ann.id, jpeg(1));
    const seen: Array<string | undefined> = [];
    const { result } = renderHook(() => {
      const url = usePhotoUrl(ann.id);
      seen.push(url);
      return url;
    });
    await waitFor(() => expect(result.current).toMatch(/^blob:/));
    const before = seen.length;
    await act(() => useRosterStore.getState().removePhoto(ann.id));
    expect(seen.length).toBeGreaterThan(before);
    expect(seen.slice(before).every((url) => url === undefined)).toBe(true);
  });

  it('never shows one player\'s picture for another when the id changes', async () => {
    const { add, setPhoto } = useRosterStore.getState();
    const ann = await add('Ann');
    const ben = await add('Ben');
    await setPhoto(ann.id, jpeg(1));
    await setPhoto(ben.id, jpeg(2));
    const seen: Array<string | undefined> = [];
    const { result, rerender } = renderHook(
      ({ id }) => {
        const url = usePhotoUrl(id);
        seen.push(url);
        return url;
      },
      { initialProps: { id: ann.id } },
    );
    await waitFor(() => expect(result.current).toMatch(/^blob:/));
    const annUrl = result.current;
    const before = seen.length;
    rerender({ id: ben.id });
    await waitFor(() => {
      expect(result.current).toBeDefined();
      expect(result.current).not.toBe(annUrl);
    });
    expect(seen.slice(before)).not.toContain(annUrl);
  });

  it('frees its url on unmount', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const ann = await useRosterStore.getState().add('Ann');
    await useRosterStore.getState().setPhoto(ann.id, jpeg(1));
    const { result, unmount } = renderHook(() => usePhotoUrl(ann.id));
    await waitFor(() => expect(result.current).toBeDefined());
    const url = result.current;
    unmount();
    expect(revoke).toHaveBeenCalledWith(url);
  });
});

it('refreshes when the revision changes but the numeric version stays the same', async () => {
  const ann = await useRosterStore.getState().add('Ann');
  await useRosterStore.getState().setPhoto(ann.id, jpeg(1));
  const { result } = renderHook(() => usePhotoUrl(ann.id));
  await waitFor(() => expect(result.current).toBeDefined());
  const previous = result.current;
  await act(async () => {
    useRosterStore.setState(s => ({ players: s.players.map(p => p.id === ann.id ? { ...p, photoRevision: 'changed-revision' } : p) }));
  });
  await waitFor(() => expect(result.current).not.toBe(previous));
});
