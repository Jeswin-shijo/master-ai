import { Body, Controller, Get, Post } from '@nestjs/common';
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
import { CurrentSession, Public, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { IdentityService } from './identity.service';

@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Post('signup')
  signup(@Body(new ZodPipe(SignupInputSchema)) body: z.output<typeof SignupInputSchema>) {
    return this.identity.signup(body);
  }

  @Public()
  @Post('login')
  login(@Body(new ZodPipe(LoginInputSchema)) body: z.output<typeof LoginInputSchema>) {
    return this.identity.login(body);
  }

  @Post('switch')
  switchCompany(@CurrentSession() s: Session, @Body(new ZodPipe(SwitchCompanyInputSchema)) body: z.output<typeof SwitchCompanyInputSchema>) {
    return this.identity.switchCompany(s, body.tenantId);
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
