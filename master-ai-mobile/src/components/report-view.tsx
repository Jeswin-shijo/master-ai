import { Share, View } from 'react-native';
import type { GoalReport } from '@onehuman/schemas';
import { reportText } from '@onehuman/sdk';
import { Button, T } from '@/components/ui';
import { space } from '@/lib/theme';

/** What a goal's work did, in plain words, with Share for sending it to a client. */
export function ReportView({ report }: { report: GoalReport }) {
  const sections: [string, string[], 'success' | 'body' | 'danger' | 'lead'][] = [
    ['What was done', report.done, 'success'],
    ['Still in progress', report.pending, 'body'],
    ['Needs attention', report.attention, 'danger'],
    ['People involved', report.people, 'lead'],
  ];
  const empty = report.done.length + report.pending.length + report.attention.length === 0;
  return (
    <View style={{ gap: space.md }}>
      {empty && (
        <T tone="lead" size="sm">
          Nothing has been done yet.
        </T>
      )}
      {sections.map(([title, lines, tone]) =>
        lines.length ? (
          <View key={title} style={{ gap: 4 }}>
            <T tone="muted" size="xs" weight="semibold">
              {title}
            </T>
            {lines.map((line, i) => (
              <T key={i} size="sm" tone={tone}>
                {line}
              </T>
            ))}
          </View>
        ) : null,
      )}
      <Button title="Share report" variant="secondary" onPress={() => void Share.share({ message: reportText(report) })} />
    </View>
  );
}
