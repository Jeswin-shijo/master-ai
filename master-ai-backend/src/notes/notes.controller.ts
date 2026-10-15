import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentSession, ManagersOnly, type Session } from '../common/auth';
import { NotesService } from './notes.service';

/** The head applies or dismisses what a call noted on an item. */
@ManagersOnly()
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post(':id/apply')
  apply(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.apply(s, id);
  }

  @Post(':id/dismiss')
  dismiss(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.dismiss(s, id);
  }
}
