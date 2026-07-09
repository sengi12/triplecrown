
// ─────────────────────────────────────────────────────────────────────────────
// Constants & URLs
// ─────────────────────────────────────────────────────────────────────────────
const NFL_LOGO = t => `https://static.www.nfl.com/t_headshot_desktop/f_auto/league/api/clubs/logos/${t==='JAX'?'JAC':t}`;
// ESPN college-team logo by ESPN team id (used on rookie player cards' college game logs).
const NCAA_LOGO = id => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
// ESPN athlete headshot (fallback when Sleeper has no photo). league = 'nfl' | 'college-football'.
const ESPN_HEADSHOT = (league,id) => `https://a.espncdn.com/i/headshots/${league}/players/full/${id}.png`;
// Primary team colors (the dominant color of each club, matching their logos). Fixed set of
// 32, so a lookup is instant, correct, CORS-free, and works in the offline baked file.
const TEAM_COLORS = {
  ARI:'#97233F', ATL:'#A71930', BAL:'#241773', BUF:'#00338D', CAR:'#0085CA',
  CHI:'#0B162A', CIN:'#FB4F14', CLE:'#311D00', DAL:'#003594', DEN:'#FB4F14',
  DET:'#0076B6', GB:'#203731', HOU:'#03202F', IND:'#002C5F', JAX:'#006778',
  KC:'#E31837', LAC:'#0080C6', LAR:'#003594', LV:'#000000', MIA:'#008E97',
  MIN:'#4F2683', NE:'#002244', NO:'#D3BC8D', NYG:'#0B2265', NYJ:'#125740',
  PHI:'#004C54', PIT:'#FFB612', SEA:'#002244', SF:'#AA0000', TB:'#D50A0A',
  TEN:'#0C2340', WAS:'#5A1414',
};
function teamColor(t){ return TEAM_COLORS[t] || '#2b2f3a'; }
// Relative luminance (0..1) of a hex color, for choosing readable text over it.
function _hexLum(hex){
  const m=/^#?([0-9a-f]{6})$/i.exec(hex||''); if(!m) return 0;
  const n=parseInt(m[1],16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  const f=c=>{c/=255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
  return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);
}
// A darkened version of a hex color (mix toward black by `amt` 0..1), for light team colors.
function _darken(hex, amt){
  const m=/^#?([0-9a-f]{6})$/i.exec(hex||''); if(!m) return hex;
  const n=parseInt(m[1],16); let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  r=Math.round(r*(1-amt)); g=Math.round(g*(1-amt)); b=Math.round(b*(1-amt));
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
// Sleeper APIs (browser can reach these directly; container cannot)
const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';
const SLEEPER_PROJ_URL = (season)=>`https://api.sleeper.com/projections/nfl/${season}?season_type=regular&grouping=season`;
const SLEEPER_STATS_URL = (season)=>`https://api.sleeper.com/stats/nfl/${season}?season_type=regular&grouping=season`;
const SLEEPER_WEEKLY_URL = (pid,season)=>`https://api.sleeper.com/stats/nfl/player/${pid}?season_type=regular&season=${season}&grouping=week`;
const SLEEPER_PICKS_URL = (draftId)=>`https://api.sleeper.app/v1/draft/${draftId}/picks`;
const SLEEPER_DRAFT_URL = (draftId)=>`https://api.sleeper.app/v1/draft/${draftId}`;
const SLEEPER_HEADSHOT = (pid)=>`https://sleepercdn.com/content/nfl/players/${pid}.jpg`;
// League-linking (username → leagues → draft) endpoints. All read-only, no auth token.
const SLEEPER_USER_URL   = (name)=>`https://api.sleeper.app/v1/user/${encodeURIComponent(name)}`;
const SLEEPER_STATE_URL  = 'https://api.sleeper.app/v1/state/nfl';
const SLEEPER_LEAGUES_URL= (userId,season)=>`https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${season}`;
const SLEEPER_LG_DRAFTS_URL=(leagueId)=>`https://api.sleeper.app/v1/league/${leagueId}/drafts`;
const SLEEPER_AVATAR_THUMB=(id)=>`https://sleepercdn.com/avatars/thumbs/${id}`;

