import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

export function KnowledgePage() {
  const queryClient = useQueryClient();
  const docs = useQuery({ queryKey: ['knowledge'], queryFn: api.knowledge.list });
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const add = useMutation({
    mutationFn: () => api.knowledge.create({ title, content }),
    onSuccess: () => {
      setTitle('');
      setContent('');
      void queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Knowledge" description="SOPs, policies, price lists and FAQs. Agents search this before acting, so they don't make things up." />
      <Card>
        <CardHeader title="Add a document" />
        <CardBody>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Field label="Title" htmlFor="doc-title">
              <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Refund policy" required />
            </Field>
            <Field label="Content" htmlFor="doc-content" hint="Paste text. It is split into searchable chunks.">
              <Textarea id="doc-content" value={content} onChange={(e) => setContent(e.target.value)} rows={6} required />
            </Field>
            <ErrorNote error={add.error} />
            <Button type="submit" loading={add.isPending}>
              <Plus /> Add to knowledge base
            </Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Documents" />
        {docs.isLoading ? (
          <Spinner />
        ) : docs.data?.length === 0 ? (
          <EmptyState icon={<BookOpen />} title="No documents yet" />
        ) : (
          <ul className="divide-y divide-border">
            {docs.data?.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="font-medium text-fg">{d.title}</span>
                <span className="text-fg-muted">
                  {d.chunks} chunk{d.chunks === 1 ? '' : 's'} · {timeAgo(d.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
