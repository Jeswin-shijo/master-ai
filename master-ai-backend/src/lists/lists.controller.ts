import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  BulkCheckInputSchema,
  CheckListItemInputSchema,
  CreateRecordInputSchema,
  RemoveListItemInputSchema,
  UpdateListItemInputSchema,
} from '@onehuman/schemas';
import { CurrentSession, ManagersOnly, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { ListsService } from './lists.service';

/** The head's lists. The owner and admins only. */
@ManagersOnly()
@Controller('lists')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get()
  overview(@CurrentSession() s: Session) {
    return this.lists.overview(s.tenantId);
  }

  @Get(':id')
  page(@CurrentSession() s: Session, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.lists.page(s.tenantId, id, query);
  }

  /** The filtered list as CSV. The web app fetches it with the session header and saves it from a Blob. */
  @Get(':id/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment')
  @Header('Cache-Control', 'no-store')
  exportCsv(@CurrentSession() s: Session, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.lists.exportCsv(s.tenantId, id, query);
  }

  @Get(':id/items/:itemId')
  item(@CurrentSession() s: Session, @Param('id') id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.lists.item(s.tenantId, id, itemId);
  }

  @Delete('samples')
  removeSamples(@CurrentSession() s: Session) {
    return this.lists.removeSamples(s);
  }

  @Post(':id/items')
  create(@CurrentSession() s: Session, @Param('id') id: string, @Body(new ZodPipe(CreateRecordInputSchema)) body: z.output<typeof CreateRecordInputSchema>) {
    return this.lists.create(s, id, body.data);
  }

  @Patch(':id/items/:itemId')
  update(
    @CurrentSession() s: Session,
    @Param('id') id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodPipe(UpdateListItemInputSchema)) body: z.output<typeof UpdateListItemInputSchema>,
  ) {
    return this.lists.update(s, id, itemId, body);
  }

  @Post(':id/items/:itemId/check')
  check(
    @CurrentSession() s: Session,
    @Param('id') id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodPipe(CheckListItemInputSchema)) body: z.output<typeof CheckListItemInputSchema>,
  ) {
    return this.lists.check(s, id, itemId, body);
  }

  /** A POST, not a DELETE: the reason travels in the body, which a DELETE may lose on the way. */
  @Post(':id/items/:itemId/remove')
  remove(
    @CurrentSession() s: Session,
    @Param('id') id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodPipe(RemoveListItemInputSchema)) body: z.output<typeof RemoveListItemInputSchema>,
  ) {
    return this.lists.remove(s, id, itemId, body);
  }

  @Post(':id/check')
  checkMany(@CurrentSession() s: Session, @Param('id') id: string, @Body(new ZodPipe(BulkCheckInputSchema)) body: z.output<typeof BulkCheckInputSchema>) {
    return this.lists.checkMany(s, id, body.ids);
  }
}
