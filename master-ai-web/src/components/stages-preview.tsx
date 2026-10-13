import { motion } from 'motion/react';

/** The 8 stages, named for the organization, rising in one after another. */
export function StagesPreview({ names, caseLabel }: { names: string[]; caseLabel: string }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={`The 8 stages of every ${caseLabel.toLowerCase()}`}>
      {names.map((name, i) => (
        <motion.li
          key={`${i}-${name}`}
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] }}
          className="glass flex items-center gap-3 rounded-md p-3"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-node font-display text-sm text-fg tabular-nums">{i + 1}</span>
          <span className="text-sm font-medium text-fg">{name}</span>
        </motion.li>
      ))}
    </ol>
  );
}
