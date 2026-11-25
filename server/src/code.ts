import { CODE_ALPHABET, CODE_LENGTH } from '../../src/online/protocol';

/** Random room code, without favouring any letter. */
export function randomCode(): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let code = '';
  while (code.length < CODE_LENGTH) {
    const [b] = crypto.getRandomValues(new Uint8Array(1));
    if (b < limit) code += CODE_ALPHABET[b % n];
  }
  return code;
}
