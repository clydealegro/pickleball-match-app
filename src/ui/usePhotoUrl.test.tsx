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
    expect(renderHook(() => usePhotoUrl(undefined)).result.current).toBeUndefined();
    expect(renderHook(() => usePhotoUrl(ann.id)).result.current).toBeUndefined();
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
