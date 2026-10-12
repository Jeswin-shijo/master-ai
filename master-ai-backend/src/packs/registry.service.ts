import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { parse } from 'yaml';
import type { Pack, PackSource, ResolvedPack } from '@onehuman/schemas';
import { parsePack, resolvePack, validatePackRefs } from '@onehuman/agent-kit';
import { config } from '../config';

/** Industry Pack registry, loaded from packs/<id>/pack.yaml. */
@Injectable()
export class PackRegistry implements OnModuleInit {
  private readonly logger = new Logger(PackRegistry.name);
  private packs = new Map<string, Pack>();

  onModuleInit() {
    this.reload();
  }

  reload() {
    const next = new Map<string, Pack>();
    if (!existsSync(config.packsDir)) {
      this.logger.error(`Pack directory not found: ${config.packsDir}`);
      return;
    }
    for (const dir of readdirSync(config.packsDir)) {
      const file = join(config.packsDir, dir, 'pack.yaml');
      if (!existsSync(file)) continue;
      try {
        const pack = parsePack(parse(readFileSync(file, 'utf8')));
        next.set(pack.id, pack);
      } catch (err) {
        this.logger.error(`Skipping ${file}: ${(err as Error).message}`);
      }
    }
    this.packs = next;
    for (const pack of next.values()) {
      const issues = validatePackRefs(this.resolve(pack));
      if (issues.length) this.logger.warn(`Pack ${pack.id} has issues:\n- ${issues.join('\n- ')}`);
    }
    this.logger.log(`Loaded ${next.size} packs: ${[...next.keys()].join(', ')}`);
  }

  get(id: string): Pack | undefined {
    return this.packs.get(id);
  }

  list(): Pack[] {
    return [...this.packs.values()];
  }

  industryPacks(): Pack[] {
    return this.list().filter((p) => p.kind === 'industry');
  }

  basePacks(): Pack[] {
    return this.list().filter((p) => p.kind === 'base');
  }

  resolve(pack: Pack, source: PackSource = 'registry'): ResolvedPack {
    return resolvePack(pack, (id) => this.packs.get(id), source);
  }

  /**
   * The current registry version of the packs an installed workspace was built
   * from, with the workspace's own labels. Null when none of them is in the registry.
   */
  latestFor(installed: ResolvedPack): ResolvedPack | null {
    const ids = installed.lineage.filter((id) => this.packs.has(id));
    if (ids.length === 0) return null;
    const empty = { entities: [], agents: [], tools: [], workflows: [], policies: [], kpis: [], connectors: [] };
    return this.resolve({ ...installed, ...empty, id: 'installed-latest', extends: ids, labels: installed.labels }, installed.source);
  }
}
