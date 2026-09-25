// Renders the Game Center drive-chart for a set of hand-built scenarios into one HTML contact
// sheet, so the six drive-chart fixes can be eyeballed with no live game on. Not shipped.
//   node tools/gc_drive_preview.js            → writes /tmp/gc_drive_preview.html
//   node tools/gc_drive_preview.js out.html   → writes out.html
const fs=require('fs'), path=require('path');
// minimal browser stubs, enough for the concatenated app to evaluate
const elStore={};
function mkEl(id){ if(!elStore[id]) elStore[id]={id,innerHTML:'',hidden:false,style:{},dataset:{},classList:{_s:new Set(),add(c){this._s.add(c);},remove(...c){c.forEach(x=>this._s.delete(x));},toggle(){},contains(c){return this._s.has(c);}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){},getBoundingClientRect:()=>({width:300,height:300,left:0,top:0})}; return elStore[id]; }
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},remove(){},addEventListener(){}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200,scrollTo(){},scrollX:0,scrollY:0};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};
global.fetch=()=>Promise.reject(new Error('offline'));
global.Chart=function(){return{destroy(){}};};

const code=fs.readFileSync(path.join(__dirname,'..','tests','check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  sleeperPlayers={};   // no Sleeper rows: the label falls back to the parsed token, and the pin to the club logo
  return { drive:gcDriveChartHTML, names:gcPlayNames, punt:gcPuntRead, pen:gcPenaltyRead };
`)();

let EID=1;
const P=(id,seq,type,text,yds,yte,extra)=>Object.assign({id, sequenceNumber:seq, type:{text:type}, text, statYardage:yds, period:{number:2}, clock:{displayValue:'7:30'}, start:{down:1, yardsToEndzone:yte, shortDownDistanceText:'1st & 10', possessionText:''}}, extra||{});
const drive=(team,plays,result)=>({drives:{previous:[{id:'d'+(EID++), team:{abbreviation:team}, description:'', result:result||'', plays}]}});
const GAME=(away,home)=>({id:away+'@'+home, away, home, home_abbr:home, away_abbr:away, state:'post', eid:'evt'+(EID++)});

function render(game, sum){ return app.drive(game, sum); }

// ── the scenarios ────────────────────────────────────────────────────────────
const cards=[];
const card=(group, title, note, svg)=>cards.push({group, title, note, svg});

// 5 · fixed orientation — the same play for the away club and the home club
{
  const play=[P('o1',1,'Rush','C.Brown left end to CIN 45 for 5 yards.',5,55)];
  const g=GAME('TB','CIN');
  card('5 · Fixed orientation (away left, home right — never flips)',
    'Away team (TB) has the ball', 'TB end zone on the LEFT · offense drives left → right',
    render(g, drive('TB', JSON.parse(JSON.stringify(play)))));
  card('5 · Fixed orientation (away left, home right — never flips)',
    'Home team (CIN) has the ball', 'CIN end zone on the RIGHT · offense drives right → left',
    render(g, drive('CIN', JSON.parse(JSON.stringify(play)))));
}

// 1 · an incompletion ends in a red X
{
  const g=GAME('TB','CIN');
  const sum=drive('CIN',[P('i1',1,'Rush','C.Brown up the middle for 6 yards.',6,60),
    P('i2',2,'Pass Incompletion','(Shotgun) J.Burrow pass incomplete deep left to J.Chase [T.Smith].',0,54)]);
  card('1 · Incompletion → red X at the end of the arc',
    'Deep incompletion', 'the throw arcs downfield (dashed) and ends in a red ✕ — no completion',
    render(g, sum));
}

// 2 · a well-known back, named — ESPN widens the shared initial for namesakes
{
  const g=GAME('ATL','NO');
  const bijan=drive('ATL',[P('b1',1,'Rush','C.Brown for 4 yards.',4,60),
    P('b2',2,'Rush','Bi.Robinson right end to ATL 46 for 6 yards (D.Wonnum).',6,54)]);
  const brian=drive('ATL',[P('r1',1,'Rush','C.Brown for 4 yards.',4,60),
    P('r2',2,'Rush','Br.Robinson up the middle to ATL 43 for 3 yards (P.Surtain).',3,54)]);
  card('2 · Named backs (ESPN\'s two-letter initial for namesakes)',
    'Bi.Robinson (Bijan)', 'reads "Bi. Robinson 6 yd rush" — was a blank "6 yd rush" before',
    render(g, bijan));
  card('2 · Named backs (ESPN\'s two-letter initial for namesakes)',
    'Br.Robinson (Brian)', 'the twin on the same club reads "Br. Robinson 3 yd rush"',
    render(g, brian));
}

// 3 · the green line is only the drive's forward progress; a kickoff is not a snap
{
  const g=GAME('TB','CIN');
  const withKo=drive('CIN',[P('k0',1,'Kickoff','C.McLaughlin kicks 65 yards from TB 35 to end zone, Touchback.',0,100),
    P('k1',2,'Pass Reception','(Shotgun) J.Burrow pass short right to J.Chase for 5 yards (A.Winfield).',5,75)]);
  card('3 · Clean progress line (a kickoff never joins the drive)',
    'First snap after the kickoff', 'just the 5-yard pass from the start of the possession — no line back to the kickoff',
    render(g, withKo));
  const multi=drive('CIN',[P('m1',1,'Rush','C.Brown for 8 yards.',8,75),
    P('m2',2,'Pass Reception','J.Burrow pass short left to T.Higgins for 12 yards.',12,67),
    P('m3',3,'Rush','C.Brown for 5 yards.',5,55)]);
  card('3 · Clean progress line (a kickoff never joins the drive)',
    'A three-snap drive', 'one quiet green line from the drive\'s start to the newest snap, then the last play\'s move',
    render(g, multi));
}

// 4 · a penalty moves the spot
{
  const g=GAME('TB','CIN');
  const off=drive('CIN',[P('p1',1,'Rush','C.Brown for 4 yards.',4,60),
    P('p2',2,'Penalty','PENALTY on CIN-F.Moreau, False Start, 5 yards, enforced at CIN 44 - No Play.',5,56)]);
  card('4 · A penalty moves the ball back/forward',
    'False start on the offense (−5)', 'the ball slides back five yards, flag at the new spot',
    render(g, off));
  const def=drive('CIN',[P('q1',1,'Rush','C.Brown for 4 yards.',4,60),
    P('q2',2,'Penalty','PENALTY on TB-L.David, Defensive Holding, 5 yards, enforced at CIN 44.',5,56)]);
  card('4 · A penalty moves the ball back/forward',
    'Defensive holding (+5)', 'a foul on the defense moves the ball forward five',
    render(g, def));
}

// 6 · the punt, in all its forms
{
  const g=GAME('TB','CIN');   // CIN punts, TB receives
  const mk=(text,result)=>drive('CIN',[P('u1',1,'Rush','C.Brown for 2 yards.',2,52),
    P('u2',2,'Punt',text,3,48)], result);
  card('6 · Punts — every outcome', 'Clean punt, returned',
    'kick arc to the catch (grey), then the return back the other way (green), returner on the pin',
    render(g, mk('M.Araiza punts 41 yards to TB 28, Center-J.Winchester. A.Bachman to TB 42 for 14 yards (E.Downs).')));
  card('6 · Punts — every outcome', 'Fair catch',
    'one kick arc, no return line — the returner is credited with the catch',
    render(g, mk('M.Araiza punts 52 yards to TB 15, Center-J.Winchester, fair catch by A.Bachman.')));
  card('6 · Punts — every outcome', 'Out of bounds / downed',
    'the kick lands and stops — no returner, no return line',
    render(g, mk('A.Cole punts 48 yards to TB 22, Center-J.Winchester, out of bounds.')));
  card('6 · Punts — every outcome', 'Touchback',
    'the kick reaches the end zone, then a dotted hop spots the ball at the receiving 20',
    render(g, mk('M.Araiza punts 60 yards to TB end zone, Center-J.Winchester, Touchback.')));
  card('6 · Punts — every outcome', 'Punt returned for a TD',
    'the return runs all the way to the punting team\'s own end zone (left/right, whichever is theirs)',
    render(g, mk('M.Araiza punts 44 yards to TB 12, Center-J.Winchester. A.Bachman for 88 yards, TOUCHDOWN.', 'TD')));
  card('6 · Punts — every outcome', 'Muff, recovered by the kicking team',
    'a red mark at the muff; possession STAYS with the punting side, its recoverer on the pin',
    render(g, mk('M.Araiza punts 45 yards to TB 20, Center-J.Winchester. A.Bachman MUFFS catch, RECOVERED by CIN-J.Trotter at TB 22.')));
  card('6 · Punts — every outcome', 'Muff, kept by the receiving team',
    'the receiving team muffs but recovers its own — a red mark, no return',
    render(g, mk('M.Araiza punts 45 yards to TB 20, Center-J.Winchester. A.Bachman MUFFS catch, RECOVERED by TB-K.Walker at TB 18.')));
  card('6 · Punts — every outcome', 'Fumble on the return, lost',
    'the return runs, then a red mark where it was coughed up and the kicking team recovered',
    render(g, mk('M.Araiza punts 40 yards to TB 30, Center-J.Winchester. A.Bachman to TB 40 for 10 yards. FUMBLES (E.Downs), RECOVERED by CIN-J.Trotter at TB 40.')));
  card('6 · Punts — every outcome', 'A flag on the return',
    'a real return, with the yellow flag noted at the spot and on the label',
    render(g, mk('M.Araiza punts 41 yards to TB 28, Center-J.Winchester. A.Bachman to TB 42 for 14 yards. PENALTY on TB-K.Walker, Offensive Holding, 10 yards, enforced at TB 42.')));
}

// 7 · kickoffs, drawn with the same logic as a punt
{
  const g=GAME('TB','CIN');
  card('7 · Kickoffs — same logic as a punt', 'Returned',
    'the kick arcs in from the kicking team\u2019s 35 (grey), the return runs on (green), returner on the pin',
    render(g, drive('TB',[P('k1',1,'Kickoff','E.McPherson kicks 60 yards from CIN 35 to TB 5. K.Johnson to TB 28 for 23 yards (J.Battle).',23,65)])));
  card('7 · Kickoffs — same logic as a punt', 'Touchback',
    'the kick reaches the end zone, a dotted hop spots the ball at the receiving 35, no return',
    render(g, drive('TB',[P('k2',1,'Kickoff','E.McPherson kicks 65 yards from CIN 35 to end zone, Touchback to the TB 35.',0,65)])));
  card('7 · Kickoffs — same logic as a punt', 'Returned for a TD',
    'the return runs all the way to the kicking team\u2019s end zone',
    render(g, drive('CIN',[P('k3',1,'Kickoff','C.McLaughlin kicks 60 yards from TB 35 to CIN 2. D.Meyers for 98 yards, TOUCHDOWN.',98,65)], 'TD')));
  card('7 · Kickoffs — same logic as a punt', 'A flag on the return',
    'the kick and return draw as normal, the flag noted at the spot',
    render(g, drive('CIN',[P('k4',1,'Kickoff','C.McLaughlin kicks 61 yards from TB 35 to CIN 4. D.Meyers to CIN 34 for 30 yards (B.Sharp).PENALTY on CIN-K.Dugger, Illegal Block Above the Waist, 10 yards, enforced at CIN 27.',30,65)])));
}

// 8 · a sack is a straight red line, not an arc
{
  const g=GAME('TB','CIN');
  card('8 · Sack — a straight red line, no arc', 'Sacked for a loss',
    'the ball slides straight back to the new spot in red — no throwing arc',
    render(g, drive('CIN',[P('z1',1,'Rush','C.Brown for 5 yards.',5,55), P('z2',2,'Sack','(Shotgun) J.Burrow sacked at CIN 42 for -8 yards (T.Hendrickson).',-8,53)])));
}

// ── the sheet ────────────────────────────────────────────────────────────────
const groups=[];
cards.forEach(c=>{ let g=groups.find(x=>x.name===c.group); if(!g){ g={name:c.group, items:[]}; groups.push(g); } g.items.push(c); });
const html=`<!doctype html><meta charset="utf-8"><title>Drive-chart preview</title>
<style>
  body{background:#0d1117;color:#e6edf3;font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:24px;}
  h1{font-size:20px;margin:0 0 4px;} .sub{color:#8b949e;margin:0 0 24px;}
  h2{font-size:15px;color:#f5c542;border-bottom:1px solid #21262d;padding-bottom:6px;margin:30px 0 14px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px;}
  .card{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:12px;}
  .card .t{font-weight:800;font-size:13px;margin:0 0 2px;}
  .card .n{color:#8b949e;font-size:12px;margin:0 0 8px;min-height:32px;}
  .card svg{width:100%;height:auto;display:block;background:#0d1117;border-radius:8px;}
  .gc-drive-sum{color:#adbac7;font-size:11px;margin-top:6px;}
</style>
<h1>Game Center — drive-chart fixes</h1>
<p class="sub">Static previews (SMIL animations play once, then freeze on the final frame). Club logos and headshots load only with a network connection; geometry, colours and labels are the point here.</p>
${groups.map(g=>`<h2>${g.name}</h2><div class="grid">${g.items.map(it=>`<div class="card"><p class="t">${it.title}</p><p class="n">${it.note}</p>${it.svg}</div>`).join('')}</div>`).join('')}
`;
const out=process.argv[2]||'/tmp/gc_drive_preview.html';
fs.writeFileSync(out, html);
console.log('wrote', out, '·', cards.length, 'cards');
