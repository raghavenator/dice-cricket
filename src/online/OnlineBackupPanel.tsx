import { useRef, useState } from 'react';
import { downloadText } from '../data/download';
import {
  MAX_ONLINE_BACKUP_BYTES, exportOnline, importOnline, previewImport, readBackup, type ImportPreview, type ReadBackup,
} from './onlineBackup';

const plural = (n: number) => `${n} match${n === 1 ? '' : 'es'}`;

/** Export and import of online matches. The main game's Backup does not include them. */
export function OnlineBackupPanel({ empty, onImported }: { empty: boolean; onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, setPending] = useState<{ data: ReadBackup; preview: ImportPreview } | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ text: (e as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  };

  const doExport = () =>
    run(async () => {
      const b = await exportOnline();
      downloadText(JSON.stringify(b), `dice-cricket-online-${new Date(b.exportedAt).toISOString().slice(0, 10)}.json`);
      setMessage({ text: `Exported ${plural(b.matches.length)}.` });
    });

  const choose = (file: File) =>
    run(async () => {
      setPending(null);
      if (file.size > MAX_ONLINE_BACKUP_BYTES) throw new Error('That file is too big');
      const data = await readBackup(await file.text());
      setPending({ data, preview: await previewImport(data) });
    });

  const doImport = () =>
    run(async () => {
      const n = await importOnline(pending!.data);
      setPending(null);
      setMessage({ text: n ? `Imported ${plural(n)}.` : 'Nothing new to import.' });
      onImported();
    });

  const p = pending?.preview;
  return (
    <div className="card on-pad on-backup">
      <h3>Back up or move your online stats</h3>
      <p className="muted small">
        Online matches are saved only in this browser, and the main game's backup does not include them. Export a file to
        keep them safe or to bring them to another browser.
      </p>
      <div className="btn-row">
        <button className="btn" disabled={busy || empty} onClick={() => void doExport()}>Export</button>
        <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Working…' : 'Import…'}</button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void choose(file);
          }}
        />
      </div>
      {p && (
        <div className="on-import">
          <p>
            {p.owner ? <><b>{p.owner}</b>'s file: </> : 'This file has '}
            {plural(p.fresh)} to add{p.already > 0 && `, ${p.already} already here`}. Its player will count as you.
          </p>
          {p.isOpponent && (
            <p className="on-error">
              You have played against {p.owner ?? 'this player'} here, so this may not be your file. If you import it, your
              matches against each other stop counting.
            </p>
          )}
          <div className="btn-row">
            <button className="btn btn-primary" disabled={busy} onClick={() => void doImport()}>{p.isOpponent ? 'Import anyway' : 'Import'}</button>
            <button className="btn btn-ghost" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      {message && <p className={message.bad ? 'on-error' : 'muted'} role="status">{message.text}</p>}
    </div>
  );
}
