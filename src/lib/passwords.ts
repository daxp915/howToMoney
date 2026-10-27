/**
 * The one place the minimum password length is written down.
 *
 * It lives outside `$lib/server` because the registration form states the rule
 * to the person typing, and importing a server module into a page component
 * would drag the auth code -- and its imports -- into the browser bundle.
 */
export const MIN_PASSWORD = 12;
