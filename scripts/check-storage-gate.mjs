// Disposable object only. Credentials arrive through a protected JSON file, never CLI arguments.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
const config = JSON.parse(await readFile(process.env.PIKL_CHECK_CREDENTIALS_FILE, 'utf8'));
assert.equal(config.staging, true, 'Use a staging project and test account');
const client = (modern) => createClient(config.url, config.publishableKey, {
 auth: { persistSession: false, autoRefreshToken: false },
 global: { headers: { Authorization: `Bearer ${config.accessToken}`, ...(modern ? {'x-pikl-sync-version':'2'} : {}) } },
});
const current = client(true), old = client(false);
const {data, error} = await current.auth.getUser(config.accessToken);
assert(!error && data.user, 'A valid staging test-user access token is required');
const path = `${data.user.id}/${randomUUID()}/${randomUUID()}.jpg`;
const bucket = c => c.storage.from('player-photos');
try {
 const uploaded = await bucket(current).upload(path, new Uint8Array([255,216,255,217]), {contentType:'image/jpeg'});
 assert(!uploaded.error, 'Current-client upload failed: check migrations and gateway header forwarding');
 await bucket(old).remove([path]);
 assert(!(await bucket(current).download(path)).error, 'Legacy client deleted the protected file');
 const removed = await bucket(current).remove([path]);
 assert(!removed.error, 'Current-client cleanup failed');
 assert((await bucket(current).download(path)).error, 'Current-client deletion did not remove the file');
 console.log('PASS: current upload/delete allowed; legacy deletion blocked through Storage gateway.');
} finally {
 const result = await bucket(current).remove([path]);
 if (result.error) throw new Error('Probe cleanup failed; remove the test object through staging administration.');
}
