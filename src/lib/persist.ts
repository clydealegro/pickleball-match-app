/**
 * Asks the browser not to clear saved players and photos when it needs space. A browser tab on Safari can lose site data
 * after about a week without a visit. Returns whether storage is now protected. Never throws, and does nothing where
 * the browser has no such call.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
