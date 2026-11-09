const JOIN = /^#\/j\/([A-Za-z0-9_-]+)$/;

/** The link code in a page address hash like "#/j/abc123", or null when the hash is anything else. */
export const parseJoinHash = (hash: string): string | null => JOIN.exec(hash)?.[1] ?? null;

/** True when the hash now names a different join code (or none) than the page was opened with. */
export const joinChanged = (previous: string | null, hash: string): boolean => parseJoinHash(hash) !== previous;
