import {
  CODE_ALPHABET, CODE_LENGTH, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, normalizeCode, parseToken,
} from '../../src/online/protocol';
import { OnlineError, asObject, parseNickname } from '../../src/online/validate';
import { ownerIdFor } from './identity';
import type { Room } from './room-object';

export { Room } from './room-object';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  CREATE_LIMIT: RateLimit;
  JOIN_LIMIT: RateLimit;
  ALLOWED_ORIGINS: string;
}

/** Random code, without favouring any letter. */
function randomCode(): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let code = '';
  while (code.length < CODE_LENGTH) {
    const [b] = crypto.getRandomValues(new Uint8Array(1));
    if (b < limit) code += CODE_ALPHABET[b % n];
  }
  return code;
}

/** The page's origin if it may use this server, else null. */
function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('Origin');
  if (!origin) return null;
  if (env.ALLOWED_ORIGINS.split(',').some((o) => o.trim() === origin)) return origin;
  try {
    const { host } = new URL(origin);
    return host === new URL(req.url).host || host === req.headers.get('Host') ? origin : null;
  } catch {
    return null;
  }
}

async function createRoom(req: Request, env: Env): Promise<string> {
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_MESSAGE_BYTES) throw new OnlineError('Message is too big');
  const raw = await req.text();
  if (raw.length > MAX_MESSAGE_BYTES) throw new OnlineError('Message is too big');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new OnlineError('Message is not valid');
  }
  const o = asObject(json, 'Message');
  if (o.v !== PROTOCOL_VERSION) throw new OnlineError('The game has been updated. Please refresh the page.');
  const nickname = parseNickname(o.nickname);
  const ownerId = await ownerIdFor(parseToken(o.token));
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    if (await env.ROOMS.get(env.ROOMS.idFromName(code)).create(code, { ownerId, nickname })) return code;
  }
  throw new Error('No free room code');
}

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    const origin = allowedOrigin(req, env);
    const headers: Record<string, string> = { Vary: 'Origin', 'Cache-Control': 'no-store' };
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
    if (!origin) return reply(403, { error: 'This page may not use the game server' });
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';

    if (pathname === '/rooms' && req.method === 'OPTIONS') {
      headers['Access-Control-Allow-Methods'] = 'POST';
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
      return new Response(null, { status: 204, headers });
    }
    if (pathname === '/rooms' && req.method === 'POST') {
      const { success } = await env.CREATE_LIMIT.limit({ key: ip });
      if (!success) return reply(429, { error: 'Too many rooms. Try again in a minute.' });
      try {
        return reply(200, { code: await createRoom(req, env) });
      } catch (e) {
        if (e instanceof OnlineError) return reply(400, { error: e.message });
        console.error(e);
        return reply(500, { error: 'Could not create a room. Try again.' });
      }
    }
    const ws = /^\/rooms\/([^/]+)\/ws$/.exec(pathname);
    if (ws && req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const code = normalizeCode(ws[1]);
      if (!code) return reply(404, { error: 'Room not found' });
      const { success } = await env.JOIN_LIMIT.limit({ key: ip });
      if (!success) return reply(429, { error: 'Too many attempts. Try again in a minute.' });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    return reply(404, { error: 'Not found' });
  },
} satisfies ExportedHandler<Env>;
