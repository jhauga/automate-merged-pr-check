// auto-check: skeleton. The assistant that writes the check replaces this file.
import { runCheck } from './.auto-check/check-kit.mjs';

await runCheck(import.meta.url, async (ctx) => {
  await ctx.layer('page', async () => {
    ctx.assert('the check has been written', false, 'run.mjs is still the skeleton auto-check copied');
  });
});
