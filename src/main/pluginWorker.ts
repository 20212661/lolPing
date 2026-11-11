import { runPlugin } from './pluginRuntime';
import { parsePluginRequest } from './pluginRunner';

// Only the parent creates this process and sends one request. Plugin results are validated at both ends.
process.parentPort.once('message', (event: { data: unknown }) => {
  const request = parsePluginRequest(event.data);
  if (!request) {
    process.parentPort.postMessage({ ok: false, error: 'pluginConfig' });
    return;
  }
  void runPlugin(request).then(
    (result) => process.parentPort.postMessage(result),
    (err: unknown) => process.parentPort.postMessage({ ok: false, error: 'pluginLoad', detail: String(err) }),
  );
});
