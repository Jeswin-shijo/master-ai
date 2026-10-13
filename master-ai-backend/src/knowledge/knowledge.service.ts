import { Body, Controller, Get, Injectable, Post } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { CreateKnowledgeDocInputSchema, type KnowledgeDoc, type Playbook } from '@onehuman/schemas';
import type { z } from 'zod';
import { AuditService, type Actor } from '../audit/audit.service';
import { CurrentSession, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { DbService, type Tx } from '../db/db.service';
import { knowledgeChunks, knowledgeDocs } from '../db/schema';

/**
 * Company knowledge base (SOPs, policies, price lists). Chunks are searched
 * with Postgres full text today; the embedding column is ready for pgvector
 * once an embedding provider is configured.
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async add(session: Session, input: z.output<typeof CreateKnowledgeDocInputSchema>): Promise<KnowledgeDoc> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const [doc] = await tx.insert(knowledgeDocs).values({ tenantId: session.tenantId, ...input }).returning();
      const chunks = chunk(input.content);
      if (chunks.length) {
        await tx.insert(knowledgeChunks).values(
          chunks.map((content, idx) => ({ tenantId: session.tenantId, docId: doc!.id, idx, content })),
        );
      }
      await this.audit.append(tx, session.tenantId, {
        type: 'knowledge.added',
        actor: { id: session.principalId, kind: 'human' },
        refId: doc!.id,
        payload: { title: input.title, chunks: chunks.length },
      });
      return { id: doc!.id, title: doc!.title, chunks: chunks.length, source: doc!.source, createdAt: doc!.createdAt.toISOString() };
    });
  }

  /** Load a pack's playbooks into Knowledge, each one once, so agents find them with knowledge.search. */
  async addPackDocs(tx: Tx, tenantId: string, playbooks: Playbook[], actor: Actor): Promise<number> {
    let added = 0;
    for (const p of playbooks) {
      const [doc] = await tx
        .insert(knowledgeDocs)
        .values({ tenantId, title: p.title, content: p.body, source: 'pack', ref: p.id })
        .onConflictDoNothing()
        .returning();
      if (!doc) continue;
      const chunks = chunk(p.body);
      if (chunks.length) await tx.insert(knowledgeChunks).values(chunks.map((content, idx) => ({ tenantId, docId: doc.id, idx, content })));
      await this.audit.append(tx, tenantId, { type: 'knowledge.added', actor, refId: doc.id, payload: { title: p.title, chunks: chunks.length, source: 'pack' } });
      added++;
    }
    return added;
  }

  async list(tenantId: string): Promise<KnowledgeDoc[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: knowledgeDocs.id,
          title: knowledgeDocs.title,
          source: knowledgeDocs.source,
          createdAt: knowledgeDocs.createdAt,
          chunks: sql<number>`(select count(*)::int from ${knowledgeChunks} where ${knowledgeChunks.docId} = ${knowledgeDocs.id})`,
        })
        .from(knowledgeDocs)
        .orderBy(desc(knowledgeDocs.createdAt));
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    });
  }

  async search(tx: Tx, query: string, limit = 5) {
    const q = sql`websearch_to_tsquery('english', ${query})`;
    const rows = await tx
      .select({
        title: knowledgeDocs.title,
        content: knowledgeChunks.content,
        rank: sql<number>`ts_rank(${knowledgeChunks.tsv}, ${q})`,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocs, eq(knowledgeDocs.id, knowledgeChunks.docId))
      .where(sql`${knowledgeChunks.tsv} @@ ${q}`)
      .orderBy(desc(sql`ts_rank(${knowledgeChunks.tsv}, ${q})`))
      .limit(limit);
    return rows.map(({ title, content }) => ({ title, content }));
  }
}

function chunk(text: string, size = 900): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (current && current.length + p.length > size) {
      out.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${p}` : p;
    while (current.length > size * 1.5) {
      out.push(current.slice(0, size));
      current = current.slice(size);
    }
  }
  if (current) out.push(current);
  return out;
}

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@CurrentSession() s: Session) {
    return this.knowledge.list(s.tenantId);
  }

  @Post()
  add(@CurrentSession() s: Session, @Body(new ZodPipe(CreateKnowledgeDocInputSchema)) body: z.output<typeof CreateKnowledgeDocInputSchema>) {
    return this.knowledge.add(s, body);
  }
}
