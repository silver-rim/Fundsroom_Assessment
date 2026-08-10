/// <reference types="vite/client" />

/**
 * Types the environment variables this app reads, so a typo in
 * `import.meta.env.VITE_...` is a compile error rather than `undefined` at
 * runtime.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
