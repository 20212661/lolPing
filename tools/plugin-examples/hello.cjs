// No imports are needed: lolPing supplies the Cordis context and its commands service.
module.exports = function helloPlugin(ctx, config) {
  const message = typeof config?.message === 'string' ? config.message : '';

  ctx.effect(() => ctx.commands.register('hello', async () => ({ ok: true, detail: message })));

  ctx.effect(() => ctx.commands.register('clipboard', async (env) => {
    const text = await env.readClipboard();
    return text.trim() ? { ok: true, detail: message + text } : { ok: false, error: 'emptyClipboard' };
  }));
};
