import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AgentsController } from './agents/agents.controller';
import { AgentsService } from './agents/agents.service';
import { ApprovalsController } from './approvals/approvals.controller';
import { ApprovalsService } from './approvals/approvals.service';
import { AuditController } from './audit/audit.controller';
import { AuditModule } from './audit/audit.service';
import { CasesController, CasesService } from './cases/cases.service';
import { MembersController, MembersService } from './members/members.service';
import { IntakeController, IntakeService } from './cases/intake.service';
import { StageModel } from './cases/stage-model';
import { CaseStagesService } from './cases/stages.service';
import { AuthGuard } from './common/auth';
import { ConnectorsService } from './connectors/connectors.service';
import { DataModule } from './data.module';
import { DbModule } from './db/db.service';
import { BusModule } from './events/bus.service';
import { GoalsController } from './goals/goals.controller';
import { GoalsService } from './goals/goals.service';
import { HealthController } from './health.controller';
import { IdentityController } from './identity/identity.controller';
import { IdentityService } from './identity/identity.service';
import { JobsModule } from './jobs/jobs.module';
import { KnowledgeController } from './knowledge/knowledge.service';
import { LlmModule } from './llm/llm.service';
import { NotificationsModule } from './notifications/notifications.service';
import { OpsController, OpsService } from './ops/ops.service';
import { AgentRuntimeService } from './orchestration/agent-runtime.service';
import { OrchestratorService } from './orchestration/orchestrator.service';
import { TaskLifecycleService } from './orchestration/task-lifecycle.service';
import { TemporalModule } from './orchestration/temporal.service';
import { PackGenerator } from './packs/generator.service';
import { PackRegistry } from './packs/registry.service';
import { PolicyService } from './policy/policy.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { ListsController } from './lists/lists.controller';
import { FollowUpCallsService } from './follow-ups/follow-up-calls.service';
import { FollowUpsController } from './follow-ups/follow-ups.controller';
import { FollowUpsService } from './follow-ups/follow-ups.service';
import { NotesController } from './notes/notes.controller';
import { NotesService } from './notes/notes.service';
import { RecordsController } from './records/records.controller';
import { OnboardingService } from './tenancy/onboarding.service';
import { TenancyController } from './tenancy/tenancy.controller';
import { TenancyService } from './tenancy/tenancy.service';
import { CallsController } from './voice/calls.controller';
import { ReportsController, ReportsService } from './reports/reports.service';
import { CollectionService } from './routines/collection.service';
import { RoutinesController } from './routines/routines.controller';
import { RoutinesService } from './routines/routines.service';
import { CallsService } from './voice/calls.service';
import { CheckinEngine } from './voice/checkin-engine';
import { TwilioService } from './voice/twilio';
import { TwilioController } from './voice/twilio.controller';
import { DelegationService } from './voice/delegation.service';
import { CollectEngine } from './voice/collect-engine';
import { FollowUpEngine } from './voice/follow-up-engine';
import { CallEngine } from './voice/engine';
import { TeamController, TeamService } from './voice/team.service';

/**
 * Modular monolith: one deployable with strict module boundaries. Each group
 * below is a future service (see docs/adr/0001-modular-monolith.md).
 */
@Module({
  imports: [DbModule, BusModule, AuditModule, LlmModule, NotificationsModule, DataModule, TemporalModule, JobsModule],
  controllers: [
    HealthController,
    IdentityController,
    MembersController,
    TenancyController,
    AgentsController,
    GoalsController,
    CasesController,
    IntakeController,
    ApprovalsController,
    AuditController,
    RecordsController,
    ListsController,
    NotesController,
    FollowUpsController,
    KnowledgeController,
    OpsController,
    TeamController,
    CallsController,
    TwilioController,
    ReportsController,
    RoutinesController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    // Identity & tenancy
    IdentityService,
    MembersService,
    TenancyService,
    OnboardingService,
    // Industry Packs
    PackRegistry,
    PackGenerator,
    // Agents, orchestration and policy
    AgentsService,
    GoalsService,
    // Cases
    CasesService,
    CaseStagesService,
    IntakeService,
    StageModel,
    ApprovalsService,
    PolicyService,
    OrchestratorService,
    AgentRuntimeService,
    TaskLifecycleService,
    // Data and connectors (records, lists and knowledge are in DataModule)
    NotesService,
    FollowUpsService,
    FollowUpCallsService,
    ConnectorsService,
    // Team and phone delegation
    TeamService,
    CallEngine,
    CollectEngine,
    FollowUpEngine,
    DelegationService,
    TwilioService,
    ReportsService,
    CollectionService,
    RoutinesService,
    CheckinEngine,
    CallsService,
    // Ops and realtime
    OpsService,
    RealtimeGateway,
  ],
})
export class AppModule {}
