/**
 * @landing-ai/design-system
 *
 * Design tokens, theme presets, Arabic-first typography, and RTL utilities.
 * Components consume semantic/component tokens only — never raw primitives.
 */

export * from './tokens';
export type { Theme, DensityFactor } from './themes';
export { THEMES, getTheme, resolveTheme, warmProfessional } from './themes';
export { getFontFamily, getFontStack, headingLineHeight, typeScale } from './typography';
export type { Script, FontStack } from './typography';
export {
  directionFromLocale,
  getLogicalStart,
  getLogicalEnd,
  QA_LANES,
} from './rtl';
export type { Direction } from './rtl';