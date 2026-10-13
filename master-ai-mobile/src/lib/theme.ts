import { brandPalette, darkPalette, fontSize, gradients, radius, space, type Palette } from '@onehuman/ui';
import { useSession } from './session';

/** Red Hat, loaded in the root layout from @expo-google-fonts. Weights are separate families. */
export const font = {
  displayLight: 'RedHatDisplay_300Light',
  display: 'RedHatDisplay_400Regular',
  text: 'RedHatText_400Regular',
  medium: 'RedHatText_500Medium',
  semibold: 'RedHatText_600SemiBold',
} as const;

/**
 * Shared design tokens from @onehuman/ui, with the tenant's brand colour
 * applied. The app is dark by design (Glow), whatever the phone's setting.
 */
export function useTheme(): { c: Palette; dark: boolean } {
  const brand = useSession((s) => s.tenant?.settings.brandColor);
  return { c: brandPalette(darkPalette, brand), dark: true };
}

/** The Approvals tab badge: warm, because a person is needed, with a dark count that reads at AA. */
export function tabBadge(c: Palette) {
  return { backgroundColor: c.warning, color: c.background };
}

export { fontSize, gradients, radius, space };
