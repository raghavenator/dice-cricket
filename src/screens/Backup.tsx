import { useRef, useState } from 'react';
import { useGame } from '../store/useGameStore';
import {
  BackupError, MAX_BACKUP_BYTES, backupCounts, backupFilename, downloadBackup, exportBackup, importBackup, parseBackup,
  type Backup, type Counts,
} from '../data/backup';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const describe = (c: Pick<Counts, 'matches' | 'tournaments' | 'series' | 'teams'>) =>
  [plural(c.matches, 'match', 'matches'), plural(c.tournaments, 'tournament'), plural(c.series, 'series', 'series'), plural(c.teams, 'team')].join(', ');
const message = (e: unknown) => (e instanceof BackupError || e instanceof Error ? e.message : String(e));

export function BackupScreen() {
  const go = useGame((s) => s.go);
  const init = useGame((s) => s.init);
  const setPrefs = useGame((s) => s.setPrefs);
  const current = {
    matches: useGame((s) => s.history.length),
    tournaments: useGame((s) => s.tournaments.length),
    series: useGame((s) => s.series.length),
    teams: useGame((s) => s.teams.length),
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ backup: Backup; fileName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await task();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const onExport = () =>
    run(async () => {
      downloadBackup(await exportBackup(), backupFilename());
      setDone('Backup downloaded. Keep the file somewhere safe.');
    });

  const onFile = (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    setPending(null);
    void run(async () => {
      if (file.size > MAX_BACKUP_BYTES) throw new BackupError('File is too large to be a Dice Cricket backup.');
      try {
        setPending({ backup: parseBackup(await file.text()), fileName: file.name });
      } catch (e) {
        throw new BackupError(`Nothing was imported from ${file.name}. ${message(e)}`);
      }
    });
  };

  const onImport = (mode: 'merge' | 'replace') => {
    if (!pending) return;
    if (
      mode === 'replace' &&
      !window.confirm(
        'Replace ALL teams, matches, tournaments and series in this browser with the backup file?\n\n' +
          'A copy of your current data will be downloaded first.',
      )
    )
      return;
    void run(async () => {
      if (mode === 'replace') downloadBackup(await exportBackup(), backupFilename('before-replace'));
      const counts = await importBackup(pending.backup, mode);
      if (mode === 'replace' && pending.backup.prefs) setPrefs(pending.backup.prefs);
      await init();
      setPending(null);
      setDone(`${mode === 'merge' ? 'Merged' : 'Loaded'} ${describe(counts)} from ${pending.fileName}.`);
    });
  };

  const fileCounts = pending && backupCounts(pending.backup.data);
  const fileDate = pending?.backup.exportedAt
    ? new Date(pending.backup.exportedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : 'an unknown date';

  return (
    <div className="screen backup">
      <h2>Backup & Restore</h2>
      <p className="muted">
        Your data is saved only in this browser, at this address. Export a file to keep a backup, or to move your data to
        another browser or computer.
      </p>

      <div className="card">
        <div className="card-head"><h3>In this browser</h3></div>
        <p className="backup-body">{describe(current)}</p>
      </div>

      <div className="card">
        <div className="card-head"><h3>Export</h3></div>
        <div className="backup-body">
          <p className="muted small">Downloads everything (teams, tournaments, series, every match and your settings) as one .json file.</p>
          <button className="btn btn-primary" disabled={busy} onClick={onExport}>Export data</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Import</h3></div>
        <div className="backup-body">
          <p className="muted small">Load a backup file. You'll see what's in it and choose how to import before anything changes.</p>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>Import data…</button>

          {pending && fileCounts && (
            <div className="backup-pending">
              <p>
                <b>{pending.fileName}</b>, exported {fileDate}: {describe(fileCounts)}
                {fileCounts.live > 0 && ', plus a match in progress'}.
              </p>
              <div className="btn-row">
                <button className="btn btn-primary" disabled={busy} onClick={() => onImport('merge')}>Merge</button>
                <button className="btn" disabled={busy} onClick={() => onImport('replace')}>Replace…</button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
              </div>
              <p className="muted small">
                <b>Merge</b> keeps everything here and adds the file's records. <b>Replace</b> wipes this browser's data and
                loads only the file, after downloading a safety copy.
              </p>
            </div>
          )}
        </div>
      </div>

      {error && <p className="backup-msg backup-error" role="alert">{error}</p>}
      {done && <p className="backup-msg backup-ok" role="status">{done}</p>}

      <button className="btn btn-ghost" onClick={() => go({ name: 'home' })}>← Home</button>
    </div>
  );
}
