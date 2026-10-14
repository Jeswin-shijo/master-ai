import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  LoginInputSchema,
  RegisterDeviceKeyInputSchema,
  RegisterPushTokenInputSchema,
  SignupInputSchema,
  SwitchCompanyInputSchema,
  type RegisterDeviceKeyInput,
  type RegisterPushTokenInput,
} from '@onehuman/schemas';
import type { z } from 'zod';
import { CurrentSession, issueStreamTicket, Public, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { IdentityService } from './identity.service';

@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Post('signup')
  signup(@Body(new ZodPipe(SignupInputSchema)) body: z.output<typeof SignupInputSchema>, @Req() req: Request) {
    return this.identity.signup(body, req.ip ?? 'unknown');
  }

  @Public()
  @Post('login')
  login(@Body(new ZodPipe(LoginInputSchema)) body: z.output<typeof LoginInputSchema>, @Req() req: Request) {
    return this.identity.login(body, req.ip ?? 'unknown');
  }

  @Post('switch')
  switchCompany(@CurrentSession() s: Session, @Body(new ZodPipe(SwitchCompanyInputSchema)) body: z.output<typeof SwitchCompanyInputSchema>) {
    return this.identity.switchCompany(s, body.tenantId);
  }

  /** A one-minute ticket for opening the live stream or a task's text stream. */
  @Post('stream-ticket')
  streamTicket(@CurrentSession() s: Session) {
    return { ticket: issueStreamTicket(s) };
  }

  @Get('me')
  me(@CurrentSession() s: Session) {
    return this.identity.me(s);
  }

  @Post('device-keys')
  registerDeviceKey(@CurrentSession() s: Session, @Body(new ZodPipe(RegisterDeviceKeyInputSchema)) body: RegisterDeviceKeyInput) {
    return this.identity.registerDeviceKey(s, body);
  }

  @Get('device-keys')
  deviceKeys(@CurrentSession() s: Session) {
    return this.identity.deviceKeys(s);
  }

  @Post('push-tokens')
  registerPushToken(@CurrentSession() s: Session, @Body(new ZodPipe(RegisterPushTokenInputSchema)) body: RegisterPushTokenInput) {
    return this.identity.registerPushToken(s, body);
  }
}
