import { describe, expect, it } from 'vitest';
import source from './main.tsx?raw';

// main.tsx runs on import, so it cannot be loaded in a test. These read it instead.
describe('main.tsx', () => {
  it('reads the hash once and chooses the root with chooseRoot', () => {
    expect(source).toContain("import { chooseRoot, watchJoin } from './chooseRoot';");
    expect(source.match(/chooseRoot\(location\.hash\)/g)).toHaveLength(1);
  });

  it('renders the member page for a member choice and the app otherwise, inside StrictMode', () => {
    expect(source).toMatch(/<React\.StrictMode>\{choice\.kind === 'member' \? <MemberRoot code=\{choice\.code\} \/> : <App \/>\}<\/React\.StrictMode>/);
  });

  it('reloads on a changed join hash', () => {
    expect(source).toContain("watchJoin(choice.kind === 'member' ? choice.code : null, window, () => location.reload());");
  });

  it('keeps the service worker and the update store for both roots', () => {
    expect(source).toContain('registerSW({');
    expect(source).toContain('useUpdateStore.getState().markReady');
    expect(source).toContain('applyTheme(getInitialTheme());');
  });
});
