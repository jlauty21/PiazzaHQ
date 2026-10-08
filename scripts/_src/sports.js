'use strict';
// Sports scores (TheSportsDB): team search and a team's next/last games.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/data-feeds-offline.test.js.
module.exports = function registerSports({ app, fetchJsonWithUA }) {
  // TheSportsDB's "3" key is their published free/test key intended for exactly
  // this kind of personal, low-volume, non-commercial use (see thesportsdb.com/api.php).
  // NOTE: true real-time in-play score ticking is a paid-tier feature on TheSportsDB;
  // this only surfaces the next scheduled game and the most recent final score, which
  // is what the free tier actually supports.
  const SPORTSDB_KEY = '3';
  // TheSportsDB's own search endpoint favors something closer to prefix/exact
  // matching over a true substring search — "Packers" alone doesn't surface
  // "Green Bay Packers" the way searching "Green Bay" does, even though it's
  // the same team. Not something fixable by tweaking a query parameter, since
  // the matching itself happens on their end, not ours. This is a practical
  // middle ground: a lookup table of common nickname -> full team name for the
  // major leagues (where fans would naturally just type the nickname), used to
  // ALSO search the full name alongside whatever the raw query already finds —
  // not a replacement for the direct query, since that still correctly
  // handles anything typed in full already.
  const SPORTS_NICKNAME_MAP = {
    // NFL
    cardinals: ['Arizona Cardinals'], falcons: ['Atlanta Falcons'], ravens: ['Baltimore Ravens'],
    bills: ['Buffalo Bills'], panthers: ['Carolina Panthers'], bears: ['Chicago Bears'],
    bengals: ['Cincinnati Bengals'], browns: ['Cleveland Browns'], cowboys: ['Dallas Cowboys'],
    broncos: ['Denver Broncos'], lions: ['Detroit Lions'], packers: ['Green Bay Packers'],
    texans: ['Houston Texans'], colts: ['Indianapolis Colts'], jaguars: ['Jacksonville Jaguars'],
    chiefs: ['Kansas City Chiefs'], raiders: ['Las Vegas Raiders'], chargers: ['Los Angeles Chargers'],
    rams: ['Los Angeles Rams'], dolphins: ['Miami Dolphins'], vikings: ['Minnesota Vikings'],
    patriots: ['New England Patriots'], saints: ['New Orleans Saints'],
    giants: ['New York Giants', 'San Francisco Giants'], jets: ['New York Jets'],
    eagles: ['Philadelphia Eagles'], steelers: ['Pittsburgh Steelers'],
    '49ers': ['San Francisco 49ers'], niners: ['San Francisco 49ers'], seahawks: ['Seattle Seahawks'],
    buccaneers: ['Tampa Bay Buccaneers'], bucs: ['Tampa Bay Buccaneers'], titans: ['Tennessee Titans'],
    commanders: ['Washington Commanders'],
    // NBA
    hawks: ['Atlanta Hawks'], celtics: ['Boston Celtics'], nets: ['Brooklyn Nets'],
    hornets: ['Charlotte Hornets'], bulls: ['Chicago Bulls'], cavaliers: ['Cleveland Cavaliers'],
    cavs: ['Cleveland Cavaliers'], mavericks: ['Dallas Mavericks'], mavs: ['Dallas Mavericks'],
    nuggets: ['Denver Nuggets'], pistons: ['Detroit Pistons'], warriors: ['Golden State Warriors'],
    rockets: ['Houston Rockets'], pacers: ['Indiana Pacers'], clippers: ['Los Angeles Clippers'],
    lakers: ['Los Angeles Lakers'], grizzlies: ['Memphis Grizzlies'], heat: ['Miami Heat'],
    bucks: ['Milwaukee Bucks'], timberwolves: ['Minnesota Timberwolves'], wolves: ['Minnesota Timberwolves'],
    pelicans: ['New Orleans Pelicans'], knicks: ['New York Knicks'], thunder: ['Oklahoma City Thunder'],
    magic: ['Orlando Magic'], '76ers': ['Philadelphia 76ers'], sixers: ['Philadelphia 76ers'],
    suns: ['Phoenix Suns'], blazers: ['Portland Trail Blazers'], kings: ['Sacramento Kings'],
    spurs: ['San Antonio Spurs'], raptors: ['Toronto Raptors'], jazz: ['Utah Jazz'],
    wizards: ['Washington Wizards'],
    // MLB (only nicknames not already covered above)
    diamondbacks: ['Arizona Diamondbacks'], dbacks: ['Arizona Diamondbacks'], braves: ['Atlanta Braves'],
    orioles: ['Baltimore Orioles'], redsox: ['Boston Red Sox'], cubs: ['Chicago Cubs'],
    whitesox: ['Chicago White Sox'], reds: ['Cincinnati Reds'], guardians: ['Cleveland Guardians'],
    rockies: ['Colorado Rockies'], tigers: ['Detroit Tigers'], astros: ['Houston Astros'],
    royals: ['Kansas City Royals'], angels: ['Los Angeles Angels'], dodgers: ['Los Angeles Dodgers'],
    marlins: ['Miami Marlins'], brewers: ['Milwaukee Brewers'], twins: ['Minnesota Twins'],
    mets: ['New York Mets'], yankees: ['New York Yankees'], athletics: ['Oakland Athletics'],
    phillies: ['Philadelphia Phillies'], pirates: ['Pittsburgh Pirates'], padres: ['San Diego Padres'],
    mariners: ['Seattle Mariners'], cardinalsmlb: ['St. Louis Cardinals'], rays: ['Tampa Bay Rays'],
    rangers: ['Texas Rangers', 'New York Rangers'], bluejays: ['Toronto Blue Jays'], nationals: ['Washington Nationals'],
    // NHL (only nicknames not already covered above)
    ducks: ['Anaheim Ducks'], coyotes: ['Arizona Coyotes'], sabres: ['Buffalo Sabres'],
    flames: ['Calgary Flames'], hurricanes: ['Carolina Hurricanes'], blackhawks: ['Chicago Blackhawks'],
    avalanche: ['Colorado Avalanche'], bluejackets: ['Columbus Blue Jackets'], stars: ['Dallas Stars'],
    redwings: ['Detroit Red Wings'], oilers: ['Edmonton Oilers'], panthersnhl: ['Florida Panthers'],
    wild: ['Minnesota Wild'], canadiens: ['Montreal Canadiens'], predators: ['Nashville Predators'],
    devils: ['New Jersey Devils'], islanders: ['New York Islanders'], senators: ['Ottawa Senators'],
    flyers: ['Philadelphia Flyers'], penguins: ['Pittsburgh Penguins'], sharks: ['San Jose Sharks'],
    kraken: ['Seattle Kraken'], blues: ['St. Louis Blues'], lightning: ['Tampa Bay Lightning'],
    mapleleafs: ['Toronto Maple Leafs'], canucks: ['Vancouver Canucks'], golden_knights: ['Vegas Golden Knights'],
    capitals: ['Washington Capitals'], jetsnhl: ['Winnipeg Jets'],
  };

  app.get('/api/sports/search-team', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ teams: [] });
    try {
      // Search the raw query as typed, PLUS the full name for any known nickname
      // match, merging and deduping by team id. Every search still runs
      // through TheSportsDB's own endpoint either way — this only ever adds
      // additional, more specific queries alongside it, never replaces it.
      const queries = [q];
      const nicknameKey = q.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (SPORTS_NICKNAME_MAP[nicknameKey]) {
        for (const fullName of SPORTS_NICKNAME_MAP[nicknameKey]) {
          if (!queries.some(existing => existing.toLowerCase() === fullName.toLowerCase())) queries.push(fullName);
        }
      }
      const results = await Promise.all(queries.map(query =>
        fetchJsonWithUA(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/searchteams.php?t=${encodeURIComponent(query)}`)
          .catch(() => ({ teams: [] }))
      ));
      const seen = new Set();
      const teams = [];
      for (const raw of results) {
        for (const t of (raw.teams || [])) {
          if (seen.has(t.idTeam)) continue;
          seen.add(t.idTeam);
          teams.push({ id: t.idTeam, name: t.strTeam, badge: t.strTeamBadge || null, sport: t.strSport || '', league: t.strLeague || '' });
          if (teams.length >= 8) break;
        }
        if (teams.length >= 8) break;
      }
      res.json({ teams });
    } catch (e) {
      res.status(500).json({ error: 'Could not reach TheSportsDB — ' + e.message });
    }
  });
  // Cache per team id for a few minutes — schedule/final-score data doesn't need to be
  // fetched on every single display poll.
  const sportsTeamCache = new Map(); // teamId -> { fetchedAt, data }
  const SPORTS_CACHE_MS = 10 * 60 * 1000;
  app.get('/api/sports/team/:id', async (req, res) => {
    const id = req.params.id;
    const cached = sportsTeamCache.get(id);
    if (cached && (Date.now() - cached.fetchedAt) < SPORTS_CACHE_MS) {
      return res.json(cached.data);
    }
    try {
      const [nextRaw, lastRaw] = await Promise.all([
        fetchJsonWithUA(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventsnext.php?id=${encodeURIComponent(id)}`).catch(() => null),
        fetchJsonWithUA(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventslast.php?id=${encodeURIComponent(id)}`).catch(() => null),
      ]);
      // TheSportsDB is inconsistent about the wrapper key across endpoints — check
      // both "events" and "results" defensively rather than assuming one.
      const nextEvents = (nextRaw && (nextRaw.events || nextRaw.results)) || [];
      const lastEvents = (lastRaw && (lastRaw.results || lastRaw.events)) || [];
      const mapEvent = (e) => e ? ({
        id: e.idEvent, name: e.strEvent, league: e.strLeague || '',
        home: e.strHomeTeam, away: e.strAwayTeam,
        homeScore: (e.intHomeScore != null) ? Number(e.intHomeScore) : null,
        awayScore: (e.intAwayScore != null) ? Number(e.intAwayScore) : null,
        date: e.dateEvent || '', time: e.strTime || '', venue: e.strVenue || '',
      }) : null;
      const payload = {
        nextEvent: mapEvent(nextEvents[0]),
        lastEvent: mapEvent(lastEvents[0]),
      };
      sportsTeamCache.set(id, { fetchedAt: Date.now(), data: payload });
      res.json(payload);
    } catch (e) {
      if (cached) return res.json({ ...cached.data, stale: true });
      res.status(500).json({ error: 'Could not reach TheSportsDB — ' + e.message });
    }
  });
};
