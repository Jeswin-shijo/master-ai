import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentSession, ManagersOnly, type Session } from '../common/auth';
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
}
