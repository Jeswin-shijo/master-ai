import { brandPalette, darkPalette, fontSize, radius, space, type Palette } from '@onehuman/ui';
import { useSession } from './session';

/**
 * Shared design tokens from @onehuman/ui, with the tenant's brand colour
 * applied. The app is dark by design (n8n style), whatever the phone's setting.
 */
export function useTheme(): { c: Palette; dark: boolean } {
  const brand = useSession((s) => s.tenant?.settings.brandColor);
  return { c: brandPalette(darkPalette, brand), dark: true };
}

export { fontSize, radius, space };
