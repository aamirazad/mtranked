declare global {
  namespace App {}
  /** Public URL of this fork's source code (GPL-3.0). */
  const __SOURCE_URL__: string;
  /** Contact address shown in the terms and privacy policy. */
  const __CONTACT_EMAIL__: string;
  /** Sentry DSN for browser error reports; empty disables reporting. */
  const __SENTRY_DSN__: string;
}
export {};
