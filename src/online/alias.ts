/** `?guest=2` gives a second, separate player in the same browser, for testing. Never in the published game. */
const name = import.meta.env.DEV && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('guest') : null;

export const ALIAS = name ? `-${name}` : '';
