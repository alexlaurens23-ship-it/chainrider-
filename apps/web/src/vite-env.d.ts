// Minimal Vite env typing (the project sets tsconfig "types": [], so vite/client
// isn't pulled in globally). Declares the env vars the app reads.
interface ImportMetaEnv {
  /** Override the API base origin/path; defaults to the relative "/api". */
  readonly VITE_API_BASE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
