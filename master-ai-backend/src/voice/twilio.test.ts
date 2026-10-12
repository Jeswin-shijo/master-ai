import { describe, expect, it } from 'vitest';
import { toE164, twilioSignature, twiml } from './twilio';

describe('twilioSignature', () => {
  const url = 'https://example.ngrok.app/voice/twilio/turn?t=11111111-1111-4111-8111-111111111111&c=22222222-2222-4222-8222-222222222222';
  const params = { CallSid: 'CA1234567890ABCDE', SpeechResult: 'Yes, by Friday 5 pm', Confidence: '0.92', From: '+14155550123', To: '+918925171697' };

  it('matches an independent HMAC-SHA1 of the URL and sorted fields', () => {
    // Reference value computed separately (Python hmac) with auth token "test-auth-token".
    expect(twilioSignature('test-auth-token', url, params)).toBe('0++6NNdpZJgSSwRaGKu0+/plKiQ=');
  });

  it('changes when the URL, a field or the token changes', () => {
    const base = twilioSignature('test-auth-token', url, params);
    expect(twilioSignature('test-auth-token', url.replace('1111-4111', '1111-4112'), params)).not.toBe(base);
    expect(twilioSignature('test-auth-token', url, { ...params, SpeechResult: 'No' })).not.toBe(base);
    expect(twilioSignature('other-token', url, params)).not.toBe(base);
  });
});

describe('toE164', () => {
  it.each([
    ['+91 89251 71697', '+918925171697'],
    ['+91 8925171697', '+918925171697'],
    ['8925171697', '+918925171697'],
    ['08925171697', '+918925171697'],
    ['0091 89251 71697', '+918925171697'],
    ['+1 (415) 555-0123', '+14155550123'],
  ])('%s → %s', (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(['12345', 'call me', '+0 123 456 789'])('rejects %s', (input) => {
    expect(toE164(input)).toBeNull();
  });
});

describe('twiml', () => {
  it('speaks, then listens for an Indian-English reply at the action URL', () => {
    const xml = twiml.ask('Hi Ravi, can you take this on?', 'https://x.app/voice/twilio/turn?t=a&c=b', 'Polly.Aditi');
    expect(xml).toContain('<Gather input="speech" language="en-IN"');
    expect(xml).toContain('action="https://x.app/voice/twilio/turn?t=a&amp;c=b"');
    expect(xml).toContain('<Say voice="Polly.Aditi" language="en-IN">Hi Ravi, can you take this on?</Say>');
  });

  it('escapes what the AI says and hangs up at the end', () => {
    const xml = twiml.end('Rooms <A> & "B" are done.', 'Polly.Aditi');
    expect(xml).toContain('Rooms &lt;A&gt; &amp; &quot;B&quot; are done.');
    expect(xml).toMatch(/<Hangup\/><\/Response>$/);
  });
});
