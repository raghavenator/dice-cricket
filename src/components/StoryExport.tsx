import { useEffect, useMemo, useState } from 'react';
import { db, type MatchRecord } from '../data/db';
import { downloadText, slug } from '../data/download';
import { useGame } from '../store/useGameStore';
import { DEFAULT_STORY_PROMPT, buildSeriesStory, buildTournamentStory, storyJson, storyText } from '../engine/story';
import type { Tournament } from '../engine/tournament';
import type { Series } from '../engine/series';

type Props = { tournament: Tournament; series?: never } | { series: Series; tournament?: never };

const size = (chars: number) => {
  const kb = chars / 1024;
  const tokens = chars / 4;
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);
  return `≈ ${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB · ~${fmt(tokens)} tokens`;
};

export function StoryExport({ tournament, series }: Props) {
  const teams = useGame((s) => s.teams);
  const prefs = useGame((s) => s.prefs);
  const setPrefs = useGame((s) => s.setPrefs);
  const [records, setRecords] = useState<MatchRecord[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const detail = prefs.storyDetail ?? 'full';
  const includePrompt = prefs.storyIncludePrompt ?? true;
  const prompt = prefs.storyPrompt ?? DEFAULT_STORY_PROMPT;
  const id = tournament?.id ?? series!.id;
  const name = tournament?.name ?? series!.name;

  useEffect(() => {
    const q = tournament ? db.matches.where('tournamentId').equals(id) : db.matches.where('seriesId').equals(id);
    void q.toArray().then(setRecords);
  }, [id, tournament]);

  const story = useMemo(() => {
    if (!records) return null;
    const opts = { detail, instructions: includePrompt ? prompt : undefined };
    return tournament ? buildTournamentStory(tournament, records, teams, opts) : buildSeriesStory(series!, records, teams, opts);
  }, [records, detail, includePrompt, prompt, tournament, series, teams]);
  const copyText = useMemo(() => (story ? storyText(story) : ''), [story]);

  const download = () => {
    if (!story) return;
    downloadText(storyJson(story), `${slug(name)}-story.json`);
    setNote('Downloaded.');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setNote('Copied. Paste it into your LLM chat.');
    } catch {
      setNote("Couldn't copy, use Download instead.");
    }
  };

  return (
    <div className="card story-export">
      <div className="card-head">
        <h3>📖 Story export</h3>
        <span className="muted small">For an LLM to write the story of this {tournament ? 'tournament' : 'series'}</span>
      </div>
      <div className="story-body">
        <div className="story-row">
          <span className="story-label">Detail</span>
          <div className="seg">
            <button className={`seg-btn ${detail === 'full' ? 'seg-on' : ''}`} onClick={() => setPrefs({ storyDetail: 'full' })}>Full</button>
            <button className={`seg-btn ${detail === 'compact' ? 'seg-on' : ''}`} onClick={() => setPrefs({ storyDetail: 'compact' })}>Compact</button>
          </div>
          <span className="muted small">
            {detail === 'full'
              ? 'Every batter, bowler and fall of wickets.'
              : 'Top 3 batters and bowlers per innings, top 15 in player stats. Fits small LLMs.'}
          </span>
        </div>

        <div className="story-row">
          <span className="story-label">Prompt</span>
          <div className="seg">
            <button className={`seg-btn ${includePrompt ? 'seg-on' : ''}`} onClick={() => setPrefs({ storyIncludePrompt: true })}>Include prompt</button>
            <button className={`seg-btn ${!includePrompt ? 'seg-on' : ''}`} onClick={() => setPrefs({ storyIncludePrompt: false })}>Data only</button>
          </div>
        </div>

        {includePrompt && (
          <div className="story-prompt">
            <textarea
              className="text"
              rows={4}
              maxLength={5000}
              value={prompt}
              onChange={(e) => setPrefs({ storyPrompt: e.target.value })}
              aria-label="Prompt for the LLM"
            />
            {prompt !== DEFAULT_STORY_PROMPT && (
              <button className="link-btn small" onClick={() => setPrefs({ storyPrompt: undefined })}>Reset to default</button>
            )}
          </div>
        )}

        <div className="story-row">
          <div className="btn-row">
            <button className="btn btn-primary" disabled={!story} onClick={download}>Download .json</button>
            <button className="btn" disabled={!story} onClick={() => void copy()}>Copy for LLM</button>
          </div>
          <span className="muted small story-size">
            {story ? `${story.matches.length} matches · ${size(copyText.length)}` : 'Loading…'}
          </span>
        </div>
        {note && <p className="muted small story-note" role="status">{note}</p>}
      </div>
    </div>
  );
}
