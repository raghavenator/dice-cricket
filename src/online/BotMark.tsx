import { isBot } from './protocol';

/** A small "BOT" tag after a name, shown only for a computer opponent. */
export function BotMark({ ownerId }: { ownerId: string }) {
  if (!isBot(ownerId)) return null;
  return (
    <span className="on-bot" title="Computer opponent" aria-label="(computer opponent)">
      BOT
    </span>
  );
}
