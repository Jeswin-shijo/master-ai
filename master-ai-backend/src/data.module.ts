import { Module } from '@nestjs/common';
import { KnowledgeService } from './knowledge/knowledge.service';
import { ListsService } from './lists/lists.service';
import { RecordsService } from './records/records.service';

/**
 * The company's data: records, the lists over them and the knowledge base.
 * Its own module so that modules beside the app's (jobs) read the same
 * services the app does, one instance each, without importing the app.
 */
@Module({
  providers: [RecordsService, ListsService, KnowledgeService],
  exports: [RecordsService, ListsService, KnowledgeService],
})
export class DataModule {}
