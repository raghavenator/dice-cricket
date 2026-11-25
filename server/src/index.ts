import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, normalizeCode, parseToken } from '../../src/online/protocol';
import { OnlineError, asObject, parseNickname } from '../../src/online/validate';
import { ownerIdFor } from './identity';
import type { Lobby } from './lobby-object';
import type { Room } from './room-object';

export { Lobby } from './lobby-object';
export { Room } from './room-object';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LOBBY: DurableObjectNamespace<Lobby>;
  CREATE_LIMIT: RateLimit;
  JOIN_LIMIT: RateLimit;
  ALLOWED_ORIGINS: string;
  CREATE_MAX: string;
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

/** The JSON body of a request from a player, and their public id. */
async function readPlayer(req: Request): Promise<{ o: Record<string, unknown>; ownerId: string }> {
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
  return { o, ownerId: await ownerIdFor(parseToken(o.token)) };
}

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname, protocol, hostname } = new URL(req.url);
    const origin = allowedOrigin(req, env);
    const headers: Record<string, string> = { Vary: 'Origin', 'Cache-Control': 'no-store' };
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
    if (!origin) return reply(403, { error: 'This page may not use the game server' });
    // The secret guest token must never travel unencrypted.
    if (protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname))
      return reply(403, { error: 'Use https to connect' });
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';

    const results = /^\/rooms\/([^/]+)\/results$/.exec(pathname);
    if (results || pathname === '/rooms' || pathname === '/lobby' || pathname === '/quick') {
      if (req.method === 'OPTIONS') {
        headers['Access-Control-Allow-Methods'] = 'POST';
        headers['Access-Control-Allow-Headers'] = 'Content-Type';
        return new Response(null, { status: 204, headers });
      }
      if (req.method !== 'POST') return reply(404, { error: 'Not found' });
      const limiter = pathname === '/rooms' ? env.CREATE_LIMIT : env.JOIN_LIMIT;
      const { success } = await limiter.limit({ key: ip });
      if (!success) return reply(429, { error: 'Too many attempts. Try again in a minute.' });
      const lobby = env.LOBBY.get(env.LOBBY.idFromName('main'));
      const made = (code: string | null) =>
        code ? reply(200, { code }) : reply(429, { error: 'You have made a lot of rooms. Try again in a few minutes.' });
      try {
        const { o, ownerId } = await readPlayer(req);
        if (pathname === '/lobby') return reply(200, { rooms: await lobby.list(ownerId) });
        if (results) {
          const code = normalizeCode(results[1]);
          if (!code) return reply(404, { error: 'Room not found' });
          return reply(200, await env.ROOMS.get(env.ROOMS.idFromName(code)).missed(ownerId));
        }
        const who = { ownerId, nickname: parseNickname(o.nickname) };
        if (pathname === '/rooms') return made(await lobby.create(who, o.open === true ? 'open' : 'private', ip));
        const current = typeof o.current === 'string' ? normalizeCode(o.current) : null;
        return made(await lobby.quick(who, ip, current));
      } catch (e) {
        if (e instanceof OnlineError) return reply(400, { error: e.message });
        console.error(e);
        return reply(500, { error: 'Something went wrong. Try again.' });
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
