import { z } from 'zod';
import type { AiStepDef, OutputField } from '@onehuman/schemas';
import { fillTemplate } from './template';

function fieldType(f: OutputField): z.ZodType {
  switch (f.type) {
    case 'list':
      return z.array(z.string());
    case 'number':
    case 'money':
      return z.number();
    case 'yes_no':
      return z.boolean();
    case 'choice':
      return z.enum(f.options as [string, ...string[]]);
    default:
      return z.string();
  }
}

/** What the model must hand back for an AI step: typed fields, a person flag, and sources when grounded. */
export function aiOutputSchema(fields: OutputField[], grounded: boolean): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    const t = fieldType(f);
    shape[f.name] = f.type === 'list' ? t : f.required ? t : t.nullable();
  }
  shape.needs_person = z.boolean();
  shape.needs_person_reason = z.string().nullable();
  if (grounded) shape.sources = z.array(z.string());
  return z.strictObject(shape) as unknown as z.ZodType<Record<string, unknown>>;
}

export function aiOutputJsonSchema(fields: OutputField[], grounded: boolean): Record<string, unknown> {
  const s = z.toJSONSchema(aiOutputSchema(fields, grounded)) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/** What an AI step answers with no model: the offline templates, or a request for a person. */
export function aiOfflineOutput(step: AiStepDef, scope: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of step.output) out[f.name] = null;
  if (step.grounded) out.sources = [];
  if (step.offline) {
    for (const [name, tpl] of Object.entries(step.offline)) {
      if (name in out) out[name] = fillTemplate(tpl, scope).value;
    }
    out.needs_person = false;
    out.needs_person_reason = null;
  } else {
    out.needs_person = true;
    out.needs_person_reason = 'No AI model is available for this step';
  }
  return out;
}
