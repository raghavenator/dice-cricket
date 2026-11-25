/** A player's shareable id: a one-way hash of their secret token, so it cannot be used to take their seat. */
export async function ownerIdFor(token: string): Promise<string> {
  const data = new TextEncoder().encode(`dice-cricket-online:${token}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return btoa(String.fromCharCode(...hash.slice(0, 12))).replace(/\+/g, '-').replace(/\//g, '_');
}

/** A random number from 0 up to 1 with 53 secure bits, so each die face is equally likely for any practical purpose. */
export function secureRandom(): number {
  const [a, b] = crypto.getRandomValues(new Uint32Array(2));
  return ((a >>> 5) * 67108864 + (b >>> 6)) / 9007199254740992;
}
