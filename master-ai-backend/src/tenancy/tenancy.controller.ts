import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  PackInstallInputSchema,
  PackPreviewInputSchema,
  TenantSettingsInputSchema,
  type PackInstallInput,
  type PackPreviewInput,
  type TenantSettingsInput,
} from '@onehuman/schemas';
import { CurrentSession, ManagersOnly, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { PackRegistry } from '../packs/registry.service';
import { OnboardingService } from './onboarding.service';
import { TenancyService } from './tenancy.service';

@Controller()
export class TenancyController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly tenancy: TenancyService,
    private readonly registry: PackRegistry,
  ) {}

  @ManagersOnly()
  @Post('onboarding/preview')
  preview(@CurrentSession() s: Session, @Body(new ZodPipe(PackPreviewInputSchema)) body: PackPreviewInput) {
    return this.onboarding.preview(s, body);
  }

  @ManagersOnly()
  @Post('onboarding/install')
  install(@CurrentSession() s: Session, @Body(new ZodPipe(PackInstallInputSchema)) body: PackInstallInput) {
    return this.onboarding.install(s, body.draftId, body.sampleData ?? false);
  }

  @Get('packs/registry')
  registryList() {
    return this.registry.list().map((p) => ({ id: p.id, name: p.name, description: p.description, kind: p.kind, version: p.version }));
  }

  @Get('tenant')
  tenant(@CurrentSession() s: Session) {
    return this.tenancy.get(s.tenantId);
  }

  @ManagersOnly()
  @Patch('tenant/settings')
  settings(@CurrentSession() s: Session, @Body(new ZodPipe(TenantSettingsInputSchema)) body: TenantSettingsInput) {
    return this.tenancy.updateSettings(s, body);
  }

  @ManagersOnly()
  @Post('tenant/pause')
  pauseTenant(@CurrentSession() s: Session) {
    return this.tenancy.setTenantPaused(s, true);
  }

  @ManagersOnly()
  @Post('tenant/resume')
  resumeTenant(@CurrentSession() s: Session) {
    return this.tenancy.setTenantPaused(s, false);
  }

  @Get('workspaces')
  workspaces(@CurrentSession() s: Session) {
    return this.tenancy.listWorkspaces(s.tenantId);
  }

  @Get('workspaces/:id')
  workspace(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.tenancy.getWorkspace(s.tenantId, id);
  }

  @Get('workspaces/:id/policy')
  policy(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.tenancy.workspacePolicy(s.tenantId, id);
  }

  @Get('workspaces/:id/updates')
  updates(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.updates(s.tenantId, id);
  }

  @ManagersOnly()
  @Post('workspaces/:id/updates')
  applyUpdates(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.applyUpdates(s, id);
  }

  @ManagersOnly()
  @Post('workspaces/:id/pause')
  pauseWorkspace(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.tenancy.setWorkspacePaused(s, id, true);
  }

  @ManagersOnly()
  @Post('workspaces/:id/resume')
  resumeWorkspace(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.tenancy.setWorkspacePaused(s, id, false);
  }
}
