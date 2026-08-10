/**
 * Frontend configuration.
 *
 * The only module that reads `import.meta.env`. Vite inlines these at build
 * time, so everything here is public by definition — no secret ever belongs in
 * a VITE_ variable.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    // Thrown at module load, which surfaces immediately in the browser console
    // and during `vite build` — far easier to diagnose than requests silently
    // going to `undefined/customers`.
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy frontend/.env.example to frontend/.env and set it.`,
    );
  }
  return value.trim().replace(/\/+$/, '');
}

export const config = {
  /** Backend base URL, including the /api prefix. */
  apiBaseUrl: required('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL),
  appName: import.meta.env.VITE_APP_NAME?.trim() || 'Mini ERP + CRM',
} as const;
