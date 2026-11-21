import type { Team } from '../engine/types';

// Fictional sample teams. Last five in each order are the designated bowlers.
const RAW: [string, string, string, string, string[]][] = [
  ['hawks', 'Harbour Hawks', 'HAW', '#1f6feb', [
    'Arjun Mehta', 'Tom Ellery', 'Ravi Kandasamy', 'Josh Whitlow', 'Sameer Qadri', 'Leo Brandt',
    'Owen Pryce', 'Kiran Desai', 'Marcus Hale', 'Imran Baig', 'Dale Fenwick']],
  ['rhinos', 'Riverside Rhinos', 'RHI', '#8250df', [
    'Ben Calloway', 'Nikhil Rao', 'Finn Archer', 'Yusuf Malik', 'Callum Reid', 'Dev Arora',
    'Harry Stokesby', 'Sunil Perera', 'Jack Morrow', 'Zane Petersen', 'Asif Noor']],
  ['strikers', 'Summit Strikers', 'SUM', '#d1242f', [
    'Liam Ashcroft', 'Rohan Iyer', 'Kyle Danvers', 'Faisal Akhtar', 'Matt Kerrigan', 'Ajay Pillai',
    'Sam Holloway', 'Tariq Siddiqui', 'Will Danforth', 'Pranav Joshi', 'Greg Talbot']],
  ['cobras', 'Coastal Cobras', 'COB', '#1a7f37', [
    'Ethan Marsh', 'Vikram Sethi', 'Noah Fairbairn', 'Hamza Rashid', 'Ollie Thorne', 'Rahul Nair',
    'Charlie Webb', 'Danish Kaleem', 'Luke Hartigan', 'Manoj Bhat', 'Rory Quinlan']],
  ['falcons', 'Desert Falcons', 'FAL', '#bf8700', [
    'Adam Kessler', 'Shiv Chandran', 'Mason Pike', 'Bilal Haider', 'Jordan Vance', 'Anil Kothari',
    'Toby Ridley', 'Wasim Farooq', 'Nate Colborne', 'Gautam Shetty', 'Pete Ingram']],
  ['knights', 'Northern Knights', 'KNI', '#57606a', [
    'Sean Boyd', 'Aditya Menon', 'Lewis Crane', 'Omar Siraj', 'Ryan Dalby', 'Karthik Raman',
    'Hugh Mallory', 'Junaid Karim', 'Alex Carver', 'Vivek Sharma', 'Ian Lockwood']],
];

export const PRESET_TEAMS: Team[] = RAW.map(([key, name, short, color, players]) => ({
  id: `p-${key}`,
  name,
  short,
  color,
  players: players.map((n, i) => ({ id: `p-${key}-${i + 1}`, name: n, bowler: i >= 6 })),
}));
