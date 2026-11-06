/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** The Supabase project URL. Leave both unset to build the app without a backend. */
  readonly VITE_SUPABASE_URL?: string;
  /** The Supabase publishable key (starts with `sb_publishable_`). Never put a secret or service-role key here. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
