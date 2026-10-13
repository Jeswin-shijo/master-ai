import { create } from 'zustand';

export interface NewRequestPreset {
  text?: string;
  /** A case type id, e.g. from the Workflows gallery. */
  category?: string;
}

/** New request opens from anywhere: the top bar, Workflows, a flagged routine answer. */
export const useNewRequest = create<{
  open: boolean;
  preset: NewRequestPreset | null;
  show: (preset?: NewRequestPreset) => void;
  hide: () => void;
}>((set) => ({
  open: false,
  preset: null,
  show: (preset) => set({ open: true, preset: preset ?? null }),
  hide: () => set({ open: false }),
}));
