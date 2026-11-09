import { useSlotsStore, type Slot } from '../../store/slots';
import { useAuthStore } from '../auth';
import { useAttendanceStore } from './store';

/** A saved slot reaches its link this long after the last save, so a few quick edits send once. */
const SLOT_DELAY_MS = 800;

// The parts of a slot its link shows.
const shown = (s: Slot) => [s.weekday, s.startMin, s.endMin, s.venue, s.courts].join('|');

/**
 * Keeps the attendance link in step with the app: a slot saved for good updates its link, and the saved copy is
 * cleared when the organizer signs out or another account signs in. Returns a function that stops it.
 */
export function startAttendanceSync(delayMs = SLOT_DELAY_MS): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const unwatchSlots = useSlotsStore.subscribe((state, prev) => {
    if (state.slots === prev.slots) return;
    const before = new Map(prev.slots.map((s) => [s.id, s]));
    for (const slot of state.slots) {
      const old = before.get(slot.id);
      if (old && shown(old) === shown(slot)) continue;
      clearTimeout(timers.get(slot.id));
      timers.set(
        slot.id,
        setTimeout(() => {
          timers.delete(slot.id);
          const saved = useSlotsStore.getState().slots.find((s) => s.id === slot.id);
          if (saved) void useAttendanceStore.getState().syncSlot(saved);
        }, delayMs),
      );
    }
  });

  // Signed out, or a different account: the saved copy is not for this person. A sign-in that cannot be checked
  // (`unknown`) clears nothing.
  function followAccount() {
    const { status, userId } = useAuthStore.getState();
    const { ownerId, clear } = useAttendanceStore.getState();
    if (status === 'signedOut' || (status === 'signedIn' && userId && ownerId && ownerId !== userId)) clear();
  }
  followAccount();
  const unwatchAuth = useAuthStore.subscribe(followAccount);

  return () => {
    unwatchSlots();
    unwatchAuth();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
