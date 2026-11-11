import { describe, expect, it } from 'vitest';
import { parseHostMessage } from '../../src/main/pluginHostProtocol';

describe('parseHostMessage', () => {
  it('accepts each well-formed message kind', () => {
    expect(parseHostMessage({ t: 'ready', protocol: 1 })).toEqual({ t: 'ready', protocol: 1 });
    expect(parseHostMessage({ t: 'loaded', pluginId: 'p', handlers: ['hi'] })).toEqual({ t: 'loaded', pluginId: 'p', handlers: ['hi'] });
    expect(parseHostMessage({ t: 'loadFailed', pluginId: 'p', detail: 'boom' })).toEqual({ t: 'loadFailed', pluginId: 'p', detail: 'boom' });
    expect(parseHostMessage({ t: 'call', callId: 1, pluginId: 'p', invocationId: 2, method: 'open', args: ['https://x.com'] }))
      .toEqual({ t: 'call', callId: 1, pluginId: 'p', invocationId: 2, method: 'open', args: ['https://x.com'] });
    expect(parseHostMessage({ t: 'result', id: 3, op: 'append', text: 'more' })).toEqual({ t: 'result', id: 3, op: 'append', text: 'more' });
    expect(parseHostMessage({ t: 'result', id: 3, op: 'actions', actions: [{ kind: 'copy' }] })).toEqual({ t: 'result', id: 3, op: 'actions', actions: [{ kind: 'copy' }] });
    expect(parseHostMessage({ t: 'done', id: 3, result: { ok: true, detail: 'x' } })).toEqual({ t: 'done', id: 3, result: { ok: true, detail: 'x' } });
    expect(parseHostMessage({ t: 'log', pluginId: 'p', level: 'warn', text: 'hm' })).toEqual({ t: 'log', pluginId: 'p', level: 'warn', text: 'hm' });
  });

  it('rejects unknown methods, wrong fields and unknown error codes', () => {
    expect(parseHostMessage({ t: 'call', callId: 1, pluginId: 'p', method: 'sudo', args: [] })).toBeNull();
    expect(parseHostMessage({ t: 'call', callId: 1.5, pluginId: 'p', method: 'open', args: [] })).toBeNull();
    expect(parseHostMessage({ t: 'call', callId: 1, pluginId: 'p', method: 'open', args: [1, 2, 3, 4, 5, 6, 7, 8, 9] })).toBeNull();
    expect(parseHostMessage({ t: 'done', id: 1, result: { ok: false, error: 'sneaky' } })).toBeNull();
    expect(parseHostMessage({ t: 'done', id: 1, result: { ok: 1 } })).toBeNull();
    expect(parseHostMessage({ t: 'result', id: 1, op: 'set', text: 5 })).toBeNull();
    expect(parseHostMessage({ t: 'mystery' })).toBeNull();
    expect(parseHostMessage(null)).toBeNull();
  });

  it('maps an off-list result error to unknown and keeps bounded details', () => {
    const msg = parseHostMessage({ t: 'done', id: 9, result: { ok: false, error: 'timeout', detail: 'x'.repeat(9000) } });
    expect(msg).toEqual({ t: 'done', id: 9, result: { ok: false, error: 'timeout', detail: 'x'.repeat(4000) } });
  });
});
