import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { VoiceStatus } from '@onehuman/schemas';
import { config } from '../config';

/**
 * Real phone calls through Twilio Programmable Voice, over its REST API and
 * TwiML webhooks (no SDK). Each turn of the conversation is one webhook:
 * Twilio speaks the AI's line, listens, transcribes the reply and posts it
 * back. Webhook URLs carry the tenant and call ids and are signed by Twilio,
 * so a forged or edited request is refused.
 */
@Injectable()
export class TwilioService {
  status(): VoiceStatus['twilio'] {
    const required = {
      TWILIO_ACCOUNT_SID: config.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: config.TWILIO_AUTH_TOKEN,
      TWILIO_FROM_NUMBER: config.TWILIO_FROM_NUMBER,
      PUBLIC_URL: config.PUBLIC_URL,
    };
    const missing = Object.entries(required)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    return { configured: missing.length === 0, missing, from: config.TWILIO_FROM_NUMBER || null, publicUrl: config.PUBLIC_URL ?? null };
  }

  /** Public webhook URL for one call, e.g. /voice/twilio/turn?t=…&c=… */
  webhook(action: 'answer' | 'turn' | 'status', tenantId: string, callId: string, extra: Record<string, string> = {}): string {
    const q = new URLSearchParams({ t: tenantId, c: callId, ...extra });
    return `${config.PUBLIC_URL}/voice/twilio/${action}?${q.toString()}`;
  }

  /** Dial the person. Returns Twilio's call SID; throws with Twilio's message if the call is refused. */
  async placeCall(input: { to: string; tenantId: string; callId: string; ringSeconds: number }): Promise<string> {
    const s = this.status();
    if (!s.configured) throw new Error(`Twilio is not configured (missing ${s.missing.join(', ')})`);
    const to = toE164(input.to);
    if (!to) throw new Error(`"${input.to}" is not a valid phone number`);
    const form = new URLSearchParams({
      To: to,
      From: config.TWILIO_FROM_NUMBER!,
      Url: this.webhook('answer', input.tenantId, input.callId),
      Method: 'POST',
      StatusCallback: this.webhook('status', input.tenantId, input.callId),
      StatusCallbackMethod: 'POST',
      Timeout: String(input.ringSeconds),
    });
    for (const event of ['answered', 'completed']) form.append('StatusCallbackEvent', event);
    const res = await fetch(`${config.TWILIO_API_URL}/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Calls.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok || !body.sid) throw new Error(`Twilio refused the call: ${body.message ?? res.statusText}${body.code ? ` (error ${body.code})` : ''}`);
    return body.sid;
  }

  /** Check `X-Twilio-Signature` for a webhook Twilio posted to `url`. */
  verify(url: string, params: Record<string, string>, signature: string | undefined): boolean {
    if (!config.TWILIO_AUTH_TOKEN || !signature) return false;
    const expected = Buffer.from(twilioSignature(config.TWILIO_AUTH_TOKEN, url, params));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}

/** Twilio's request signature: HMAC-SHA1 over the URL followed by each POST field (sorted) as key+value. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

/** Normalise a phone number to E.164. Ten-digit numbers are taken as Indian mobiles. */
export function toE164(phone: string, countryCode = '91'): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  let e164: string;
  if (trimmed.startsWith('+')) e164 = `+${digits}`;
  else if (trimmed.startsWith('00')) e164 = `+${digits.slice(2)}`;
  else if (digits.length === 11 && digits.startsWith('0')) e164 = `+${countryCode}${digits.slice(1)}`;
  else if (digits.length === 10) e164 = `+${countryCode}${digits}`;
  else e164 = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** TwiML for one turn: say the AI's line, then listen for the reply (Indian English). */
export const twiml = {
  ask(say: string, action: string, voice = config.TWILIO_VOICE): string {
    return (
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
      `<Gather input="speech" language="en-IN" speechTimeout="auto" timeout="6" actionOnEmptyResult="true" method="POST" action="${xml(action)}">` +
      `<Say voice="${xml(voice)}" language="en-IN">${xml(say)}</Say>` +
      '</Gather></Response>'
    );
  },
  end(say: string, voice = config.TWILIO_VOICE): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xml(voice)}" language="en-IN">${xml(say)}</Say><Hangup/></Response>`;
  },
};
