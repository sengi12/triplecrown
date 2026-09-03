// The guided experience: MCP prompts — named fantasy workflows any Claude chat can run
// once the connector is added (they surface in the client's UI as ready-made starts).
// Each one tells Claude HOW to use TripleCrown's tools for that job: which tools, in what
// order, what the app's numbers mean, and what only the user can supply (their roster —
// the seed is public data, nothing personal is in it).
//
// The same five workflows appear as guide chips in the app's own chat; the wording here is
// tuned for a Claude that discovers the tools via MCP, so the two stay siblings, not copies.

// Shared preamble: the ground rules for every workflow.
const GROUND = (fmt) =>
  `Ground every claim in TripleCrown's own numbers (${fmt} scoring — this connector's format): ` +
  `call the tools rather than answering from memory, cite the numbers you used, and say when two ` +
  `sources disagree. The seed is public app data; the user's roster, league, and picks are not in ` +
  `it — ask for them when the answer depends on them.`;

export const PROMPTS = [
  {
    name: "start_sit",
    title: "Start / Sit",
    description: "Who starts this week — verdict first, from TripleCrown's projections, matchups and usage.",
    arguments: [
      { name: "players", description: "The players you're torn between (2+)", required: true },
      { name: "roster", description: "Your full roster, for context", required: false },
    ],
    text: (a, fmt) =>
      `Help me set my lineup. I'm torn between: ${a.players}.` +
      (a.roster ? `\nMy roster: ${a.roster}` : "") +
      `\n\nFor each player: get_player and compare for the app's projection, VOR and rank; team + sos ` +
      `for the matchup; player_data (sections like usage, splits, routes) when usage or matchup detail ` +
      `would change the call. Give a verdict first — who starts and how confident — then the two or ` +
      `three numbers that decided it. ${GROUND(fmt)}`,
  },
  {
    name: "draft_pick",
    title: "Draft pick",
    description: "Who to take on the clock — value vs need vs what survives to your next pick.",
    arguments: [
      { name: "available", description: "Players you're considering right now", required: true },
      { name: "roster", description: "Your picks so far (and league size / pick slot if handy)", required: false },
    ],
    text: (a, fmt) =>
      `I'm on the clock. Considering: ${a.available}.` +
      (a.roster ? `\nMy picks so far: ${a.roster}` : "") +
      `\n\nUse rankings (sort by vor) to see the board's view, compare for the head-to-heads, and ` +
      `get_player for ADP vs the app's rank — a player the market takes much later can wait a round. ` +
      `Weigh positional need against best value, and say who likely survives to my next pick. ` +
      `Verdict first: the pick, then the case. ${GROUND(fmt)}`,
  },
  {
    name: "trade_eval",
    title: "Trade eval",
    description: "Fair or fleeced — both sides of a trade priced by the app's projections and values.",
    arguments: [
      { name: "give", description: "What you'd send", required: true },
      { name: "get", description: "What you'd receive", required: false },
    ],
    text: (a, fmt) =>
      `Evaluate this trade. I give: ${a.give}.` + (a.get ? ` I get: ${a.get}.` : " (Suggest what a fair return looks like.)") +
      `\n\nPrice each player with get_player and compare (projection, VOR, rank${/dynasty/.test(fmt) ? ", dynasty value — this is a dynasty format, so age and contract matter as much as this season" : ""}); ` +
      `check team and schedule for context that changes rest-of-season value. Sum both sides, name the ` +
      `winner and by how much, and say what would flip it. ${GROUND(fmt)}`,
  },
  {
    name: "waiver_scan",
    title: "Waiver scan",
    description: "Who to add and who to drop — the wire read through TripleCrown's board.",
    arguments: [
      { name: "roster", description: "Your current roster", required: true },
      { name: "available", description: "Interesting free agents, if you have names", required: false },
    ],
    text: (a, fmt) =>
      `Scan waivers for me. My roster: ${a.roster}.` +
      (a.available ? `\nAvailable: ${a.available}` : "") +
      `\n\nUse rankings per position to find value the roster lacks, get_player on candidates` +
      (a.available ? "" : " (from the rankings board, since I gave no names)") +
      `, and compare against my weakest starter at that position. Recommend at most three moves — add ` +
      `WHO, drop WHO, and the numbers that justify each — or say the wire beats nobody I have. ${GROUND(fmt)}`,
  },
  {
    name: "player_deep_dive",
    title: "Player deep dive",
    description: "Everything the seed knows about one player — routes, splits, usage, contract, history.",
    arguments: [
      { name: "player", description: "The player's name", required: true },
    ],
    text: (a, fmt) =>
      `Give me the full picture on ${a.player}.` +
      `\n\nStart with get_player, then player_data with no section to list what the seed holds, and read ` +
      `the sections worth reading (routes, situational splits, usage, advanced stats, contract, college — ` +
      `follow what the data suggests). Add team for the offense around them and sos for what's coming. ` +
      `End with the fantasy read: what the numbers say they are right now, and the one thing that would ` +
      `change it. ${GROUND(fmt)}`,
  },
];

// prompts/list shape (metadata only, no template).
export const promptList = () =>
  PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args }));

// prompts/get: render one, or throw {code, message} for JSON-RPC to relay.
export function promptGet(name, args, fmt) {
  const p = PROMPTS.find(x => x.name === name);
  if (!p) throw Object.assign(new Error(`unknown prompt ${JSON.stringify(name)}`), { rpc: -32602 });
  const a = {};
  for (const spec of p.arguments) {
    const v = args && args[spec.name] != null ? String(args[spec.name]).trim() : "";
    if (!v && spec.required) throw Object.assign(new Error(`missing required argument ${JSON.stringify(spec.name)}`), { rpc: -32602 });
    if (v) a[spec.name] = v;
  }
  return {
    description: p.description,
    messages: [{ role: "user", content: { type: "text", text: p.text(a, fmt) } }],
  };
}
