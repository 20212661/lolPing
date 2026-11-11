import { describe, expect, it } from 'vitest';
import { explainRequest, parseExplainAnswer } from '../../src/main/actionAiExplain';

describe('explainRequest', () => {
  it('builds a chat completion for the configured endpoint, trailing slashes aside', () => {
    const { url, body } = explainRequest({ baseUrl: 'https://api.example.com/v1//', apiKey: 'k', model: 'm-1' }, 'a term');
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    const parsed = JSON.parse(body);
    expect(parsed.model).toBe('m-1');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[1]).toEqual({ role: 'user', content: 'a term' });
  });

  it('cuts very long clipboard texts', () => {
    const { body } = explainRequest({ baseUrl: 'https://x.example', apiKey: 'k', model: 'm' }, 'y'.repeat(5000));
    expect(JSON.parse(body).messages[1].content).toBe('y'.repeat(4000));
  });
});

describe('parseExplainAnswer', () => {
  it('reads the assistant message', () => {
    expect(parseExplainAnswer({ choices: [{ message: { role: 'assistant', content: ' Because. ' } }] })).toBe('Because.');
  });

  it('rejects anything that is not a message with text', () => {
    for (const raw of [
      undefined, null, 'x', [], {},
      { choices: [] },
      { choices: [{ message: null }] },
      { choices: [{ message: { content: 7 } }] },
      { choices: [{ message: { content: '   ' } }] },
      { choices: 'no' },
    ]) expect(parseExplainAnswer(raw)).toBeNull();
  });
});
