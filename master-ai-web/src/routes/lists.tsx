import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ListChecks } from 'lucide-react';
import { Link } from 'react-router';
import type { ListSummary } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { amountText } from '@/lib/lists';

function ListCard({ list }: { list: ListSummary }) {
  const sumField = list.card.sumField ? list.entity.fields.find((f) => f.name === list.card.sumField) : undefined;
  return (
    <Link to={`/lists/${list.id}`} className="glass block rounded-lg p-5 transition-colors hover:border-primary/50">
      <p className="font-display text-lg text-fg">{list.label}</p>
      <p className="mt-3 text-2xl font-semibold text-fg">
        {list.card.count} <span className="text-sm font-normal text-fg-muted">{list.card.countLabel}</span>
      </p>
      {list.card.sum !== null && (
        <p className="mt-1 text-sm text-fg-body">
          {amountText(sumField, list.card.sum)} {list.card.sumLabel}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {list.card.problems > 0 && (
          <Chip tone="danger">
            <AlertTriangle className="mr-1 inline size-3.5" aria-hidden />
            {list.card.problems} with problems
          </Chip>
        )}
        {list.card.notChecked > 0 && <Chip tone="waiting">{list.card.notChecked} not checked</Chip>}
      </div>
    </Link>
  );
}

/** The head's view: each list the organization keeps, with what needs checking. */
export function ListsPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ['lists'], queryFn: api.lists.overview });
  const removeSamples = useMutation({
    mutationFn: api.lists.removeSamples,
    onSuccess: () => {
      for (const key of ['lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  if (overview.isLoading) return <Spinner />;
  const lists = overview.data?.lists ?? [];
  const main = lists.filter((l) => l.main);
  const other = lists.filter((l) => !l.main);
  const samples = overview.data?.samples ?? 0;

  return (
    <div>
      <PageHeader
        lead="Your"
        title="lists."
        description="Everything your organization keeps track of, with totals. Problems are found for you: check each item, or correct it."
        action={
          samples > 0 && (
            <Button
              variant="secondary"
              loading={removeSamples.isPending}
              onClick={() => {
                if (window.confirm(`Remove all ${samples} sample items? Items your team or agents added stay.`)) removeSamples.mutate();
              }}
            >
              Remove sample data
            </Button>
          )
        }
      />
      {lists.length === 0 && (
        <EmptyState icon={<ListChecks />} title="No lists yet">
          Install an industry pack first.
        </EmptyState>
      )}
      {main.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {main.map((l) => (
            <ListCard key={l.id} list={l} />
          ))}
        </div>
      )}
      {other.length > 0 && (
        <section className="mt-10" aria-labelledby="other-lists">
          <h2 id="other-lists" className="text-sm font-medium text-fg-muted">
            Other lists
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {other.map((l) => (
              <li key={l.id}>
                <Link to={`/lists/${l.id}`} className="glass flex items-center justify-between rounded-md px-4 py-3 text-sm text-fg hover:text-accent">
                  <span>{l.label}</span>
                  <span className="text-fg-muted">
                    {l.card.count} {l.card.countLabel}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ErrorNote error={overview.error ?? removeSamples.error} className="mt-4" />
    </div>
  );
}
