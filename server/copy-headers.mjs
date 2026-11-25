// Cloudflare reads response headers for the page from a _headers file among the built files.
import { copyFileSync } from 'node:fs';

copyFileSync(new URL('_headers', import.meta.url), new URL('../dist-online/_headers', import.meta.url));
