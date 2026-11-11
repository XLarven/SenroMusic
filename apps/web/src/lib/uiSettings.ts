/**
 * Applies stored preferences to the document.
 *
 * Settings live on the server, so they have to be re-applied on every boot —
 * otherwise "reduce motion" and "dynamic colours" only worked until reload.
 */
export type UiSettings = {
  reducedMotion?: unknown;
  dynamicColors?: unknown;
};

export function applyUiSettings(settings: UiSettings | null | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('reduced-motion', settings?.reducedMotion === true);
  root.classList.toggle('dynamic-colors-off', settings?.dynamicColors === false);
}
