import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JobCard, JobCardEditor } from '@/components/agents/job-card';
import { cardEdit, draftOf, withoutWord, withWord } from '@/lib/job-card';
import { agentWith, CARD } from './fixtures';

const render = (node: ReactNode) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

describe('the job card', () => {
  const html = render(<JobCard agent={agentWith()} canEdit={false} />);

  it('shows the mission, what it never handles and the words of each set', () => {
    expect(html).toContain('Mission');
    expect(html).toContain(CARD.mission);
    expect(html).toContain('Never handles');
    for (const item of CARD.never) expect(html).toContain(item);
    expect(html).toContain('Escalates to a person when');
    for (const word of ['fire', 'gas leak', 'करंट', 'cylinder blast', 'tampered']) expect(html).toContain(`>${word}<`);
  });

  it('marks the inherited set, names who is alerted and quotes the reply', () => {
    expect(html).toContain('Inherited');
    expect(html.match(/Inherited/g)).toHaveLength(1);
    expect(html).toMatch(/alerts the owner/i);
    expect(html).toContain('“If anyone is in danger, please call 112 now.”');
  });

  it('says what it may do and is never allowed in plain words, never as tool names', () => {
    expect(html).toContain('May do');
    expect(html).toContain('Send messages');
    expect(html).toContain('Never allowed');
    expect(html).toContain('Give refunds');
    expect(html).not.toMatch(/refund\.issue|message\.send|records\.search/);
  });

  it('offers Edit to managers only', () => {
    expect(html).not.toContain('Edit job card');
    expect(render(<JobCard agent={agentWith()} canEdit />)).toContain('Edit job card');
  });
});

describe('editing the job card', () => {
  const html = render(<JobCardEditor draft={draftOf(CARD)} onChange={() => {}} />);

  it('a set that came with the pack has no delete control; a set the owner added has one', () => {
    expect(html).toContain('aria-label="Remove the word set Meter tampering"');
    expect(html).not.toContain('Remove the word set Emergencies');
  });

  it("lets the owner take out words they added, also on a pack set, but never the pack's own words", () => {
    expect(html).toContain('aria-label="Take out cylinder blast"');
    expect(html).toContain('aria-label="Take out tampered"');
    for (const word of ['fire', 'gas leak', 'करंट']) expect(html).not.toContain(`aria-label="Take out ${word}"`);
    const emergency = draftOf(CARD).sets[0]!;
    expect(withoutWord(emergency, 'cylinder blast').words).toEqual(['fire', 'gas leak', 'करंट']);
    expect(withoutWord(emergency, 'fire')).toBe(emergency);
  });

  it('lets words be added to any set, and only the owner set be renamed', () => {
    expect(html).toContain('aria-label="Add a word to Emergencies"');
    expect(html).toContain('aria-label="Add a word to Meter tampering"');
    expect(html).toContain('aria-label="Name of the word set Meter tampering"');
    expect(html).not.toContain('aria-label="Name of the word set Emergencies"');
  });

  it('sends every set back with its words, alert and reply, and nothing the page added', () => {
    const draft = draftOf(CARD);
    const edited = { ...draft, sets: draft.sets.map((s) => (s.id === 'emergency' ? withWord(s, 'sparking') : s)) };
    expect(cardEdit(edited)).toEqual({
      mission: CARD.mission,
      never: CARD.never,
      escalate: [
        { id: 'emergency', label: 'Emergencies', words: ['fire', 'gas leak', 'करंट', 'cylinder blast', 'sparking'], alert: 'owner', reply: 'If anyone is in danger, please call 112 now.' },
        { id: 'meter-tamper', label: 'Meter tampering', words: ['tampered'], alert: 'owner' },
      ],
    });
  });
});
