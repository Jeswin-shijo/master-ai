import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Validate a request body with a shared schema from @onehuman/schemas. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
      );
    }
    return result.data;
  }
}

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}
