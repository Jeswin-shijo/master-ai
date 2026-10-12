import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Logger, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { VoiceStatus } from '@onehuman/schemas';
import { Public } from '../common/auth';
import { config } from '../config';
import { CallsService } from './calls.service';
import { TwilioService, twiml } from './twilio';

type TwilioParams = Record<string, string>;

/** After this many silent turns in a row the AI apologises and hangs up; the workflow retries later. */
const MAX_SILENCES = 3;

/**
 * Twilio webhooks. Each one is signed by Twilio; the URL carries the tenant
 * (`t`) and our call id (`c`), and the posted CallSid must match the call we
 * placed. Replies are TwiML, so the person always hears something sensible,
 * even when something fails on our side.
 */
@Controller('voice')
export class TwilioController {
  private readonly logger = new Logger(TwilioController.name);

  constructor(
    private readonly twilio: TwilioService,
    private readonly calls: CallsService,
  ) {}

  @Get('status')
  status(): VoiceStatus {
    return { twilio: this.twilio.status() };
  }

  /** The person picked up: greet them and ask. */
  @Public()
  @Post('twilio/answer')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async answer(@Req() req: Request, @Query('t', ParseUUIDPipe) t: string, @Query('c', ParseUUIDPipe) c: string, @Body() body: TwilioParams) {
    const call = await this.authentic(req, body, t, c);
    try {
      if (call.status === 'ringing') {
        const rec = await this.calls.answer(t, c);
        return twiml.ask(lastAiLine(rec.transcript), this.twilio.webhook('turn', t, c));
      }
      if (call.status === 'in_progress') return twiml.ask(lastAiLine(call.transcript), this.twilio.webhook('turn', t, c));
      return twiml.end('Sorry, this call is no longer needed. Thank you, goodbye.');
    } catch (err) {
      return this.failed(c, err);
    }
  }

  /** One reply from the person, transcribed by Twilio. */
  @Public()
  @Post('twilio/turn')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async turn(
    @Req() req: Request,
    @Query('t', ParseUUIDPipe) t: string,
    @Query('c', ParseUUIDPipe) c: string,
    @Query('silent') silent: string | undefined,
    @Body() body: TwilioParams,
  ) {
    const call = await this.authentic(req, body, t, c);
    if (call.status !== 'in_progress') return twiml.end('This call has ended. Thank you, goodbye.');
    try {
      const said = (body.SpeechResult ?? '').trim();
      if (!said) {
        const silences = Number(silent ?? 0) + 1;
        if (silences >= MAX_SILENCES) {
          await this.calls.decline(t, c);
          return twiml.end("Sorry, I can't hear you. I'll call back later. Goodbye.");
        }
        return twiml.ask("Sorry, I didn't catch that. Could you say it again?", this.twilio.webhook('turn', t, c, { silent: String(silences) }));
      }
      const rec = await this.calls.reply(t, c, said);
      const say = lastAiLine(rec.transcript);
      return rec.status === 'in_progress' ? twiml.ask(say, this.twilio.webhook('turn', t, c)) : twiml.end(say);
    } catch (err) {
      return this.failed(c, err);
    }
  }

  /** Call progress: busy, no answer, failed, or hung up mid-conversation. */
  @Public()
  @Post('twilio/status')
  @HttpCode(204)
  async callStatus(@Req() req: Request, @Query('t', ParseUUIDPipe) t: string, @Query('c', ParseUUIDPipe) c: string, @Body() body: TwilioParams) {
    const call = await this.authentic(req, body, t, c);
    const over = ['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(body.CallStatus ?? '');
    if (over && (call.status === 'ringing' || call.status === 'in_progress')) {
      this.logger.log(`Call ${c} ended by the network: ${body.CallStatus}`);
      await this.calls.decline(t, c);
    }
  }

  /** Signature, tenant and call must all match, or the request is refused. */
  private async authentic(req: Request, body: TwilioParams, tenantId: string, callId: string) {
    const url = `${config.PUBLIC_URL}${req.originalUrl}`;
    if (!this.twilio.verify(url, body ?? {}, req.header('x-twilio-signature'))) throw new ForbiddenException('Invalid Twilio signature');
    const call = await this.calls.raw(tenantId, callId);
    if (!call || call.provider !== 'twilio' || (call.providerCallId && call.providerCallId !== body.CallSid)) {
      throw new ForbiddenException('Unknown call');
    }
    return call;
  }

  private failed(callId: string, err: unknown) {
    this.logger.error(`Call ${callId}: ${(err as Error).message}`);
    return twiml.end("Sorry, something went wrong on our side. We'll call you back. Goodbye.");
  }
}

function lastAiLine(transcript: { speaker: string; text: string }[]): string {
  return [...transcript].reverse().find((l) => l.speaker === 'ai')?.text ?? 'Hello?';
}
