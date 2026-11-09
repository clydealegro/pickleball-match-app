import { test, expect } from '@playwright/test';
test('only one tab can mutate; closing it and reloading permits the other tab', async ({ context }) => {
  const first = await context.newPage();
  await first.goto('/');
  await expect.poll(() => first.evaluate(async () => (await navigator.locks.query()).held?.some(l => l.name === 'pickleball-session-writer'))).toBe(true);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
  const attempt = () => second.evaluate(async () => {
    // Exercise the production store guard, not just the notice.
    const { useSessionStore } = await import('/src/store/sessionStore.ts');
    return useSessionStore.getState().start({name:'Release check',mode:'fairness',courtCount:1,players:[]}).ok;
  });
  expect(await attempt()).toBe(false);
  await first.close();
  await second.reload();
  await expect(second.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0);
  await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).held?.length)).toBe(1);
  expect(await attempt()).toBe(true);
  await second.reload();
  expect(await second.evaluate(() => JSON.parse(localStorage.getItem('pickleball.session.v1')!).session.name)).toBe('Release check');
});
