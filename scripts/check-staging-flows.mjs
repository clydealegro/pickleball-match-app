// Disposable test account only. Credentials come from a protected JSON file (PIKL_CHECK_CREDENTIALS_FILE),
// never CLI arguments. Same file shape as check-storage-gate.mjs. Everything is scoped to the token's own user.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const config = JSON.parse(await readFile(process.env.PIKL_CHECK_CREDENTIALS_FILE, 'utf8'));
assert.equal(config.staging, true, 'Use a staging project and test account');
const client = (modern) => createClient(config.url, config.publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${config.accessToken}`, ...(modern ? { 'x-pikl-sync-version': '2' } : {}) } },
});
const current = client(true), legacy = client(false);
const { data: who, error: whoErr } = await current.auth.getUser(config.accessToken);
assert(!whoErr && who.user, 'A valid test-user access token is required');
const owner = who.user.id;
const bucket = (c) => c.storage.from('player-photos');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : ` ${detail}`}`); };
const jpeg = () => new Uint8Array([255, 216, 255, randomUUID().charCodeAt(0), 255, 217]);
const mine = () => current.from('players').select('*').eq('owner_id', owner);

// Start from an empty roster so the final purge count is exact. Test account only.
assert.equal((await mine()).data?.length ?? 0, 0, 'Test account must start with no players');

const a = randomUUID(), b = randomUUID();
const rev1 = randomUUID(), rev2 = randomUUID();
const row = (id, name, extra = {}) => ({ owner_id: owner, id, name, photo_version: 1, photo_seq: 0, ...extra });

// Current client: roster write with a photo revision.
let r = await current.from('players').upsert(row(a, `A-${a.slice(0, 6)}`, { photo_revision: rev1 }), { onConflict: 'owner_id,id' });
check('current client can insert a player with photo_revision', !r.error, r.error?.message);

// Legacy client: reads allowed, writes denied.
const read = await legacy.from('players').select('id').eq('owner_id', owner);
check('legacy client can still read the roster', !read.error && read.data.length === 1, read.error?.message);
r = await legacy.from('players').upsert(row(b, `B-${b.slice(0, 6)}`), { onConflict: 'owner_id,id' });
check('legacy client cannot insert a player', !!r.error, 'insert was accepted');
r = await legacy.from('players').update({ name: 'LegacyOverwrite', photo_revision: null }).eq('owner_id', owner).eq('id', a).select();
const after = (await mine()).data.find((p) => p.id === a);
check('legacy client cannot update a revisioned player', after?.name !== 'LegacyOverwrite' && after?.photo_revision === rev1, `row is now ${JSON.stringify(after)}`);

// Photos: immutable UUID revisions coexist and are readable. Legacy upload, overwrite and delete are blocked.
const p1 = `${owner}/${a}/${rev1}.jpg`, p2 = `${owner}/${a}/${rev2}.jpg`;
let up = await bucket(current).upload(p1, jpeg(), { contentType: 'image/jpeg', upsert: false });
check('current client uploads revision 1', !up.error, up.error?.message);
up = await bucket(current).upload(p2, jpeg(), { contentType: 'image/jpeg', upsert: false });
check('current client uploads revision 2 (competing edit)', !up.error, up.error?.message);
check('both revisions are readable', !(await bucket(current).download(p1)).error && !(await bucket(current).download(p2)).error);
up = await bucket(legacy).upload(`${owner}/${a}/${randomUUID()}.jpg`, jpeg(), { contentType: 'image/jpeg', upsert: false });
check('legacy client cannot upload a photo', !!up.error, 'upload was accepted');
up = await bucket(legacy).upload(p1, jpeg(), { contentType: 'image/jpeg', upsert: true });
check('legacy client cannot overwrite a photo', !!up.error, 'overwrite was accepted');
await bucket(legacy).remove([p1, p2]);
check('legacy client cannot delete photos', !(await bucket(current).download(p1)).error && !(await bucket(current).download(p2)).error);

// Competing row edits from two current clients: the server keeps one row and bumps updated_at.
const before = (await mine()).data.find((p) => p.id === a).updated_at;
const [e1, e2] = await Promise.all([
  current.from('players').update({ photo_revision: rev1 }).eq('owner_id', owner).eq('id', a),
  current.from('players').update({ photo_revision: rev2 }).eq('owner_id', owner).eq('id', a),
]);
const final = (await mine()).data;
check('competing edits leave exactly one row with one of the two revisions', !e1.error && !e2.error && final.length === 1 && [rev1, rev2].includes(final[0].photo_revision) && final[0].updated_at > before);

// Purge: legacy denied, current removes only this account's rows.
const legacyPurge = await legacy.rpc('delete_my_players');
check('legacy client cannot purge the account', !!legacyPurge.error && (await mine()).data.length === 1, 'purge was accepted');
const purge = await current.rpc('delete_my_players');
check('current client purge removes this account\'s players', !purge.error && (await mine()).data.length === 0, purge.error?.message);

// Cleanup (current client). Purge does not delete storage files; the app does that separately.
const cleanup = await bucket(current).remove([p1, p2]);
check('test photos cleaned up', !cleanup.error && (await bucket(current).download(p1)).error != null);

const failed = results.filter((x) => !x.ok);
console.log(failed.length ? `\n${failed.length} FAILED` : `\nALL ${results.length} CHECKS PASSED`);
process.exit(failed.length ? 1 : 0);
