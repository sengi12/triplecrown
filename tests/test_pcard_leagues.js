// "In your leagues" on the player card: one row per synced Sleeper league with
// ★ MINE / the owner's team / AVAILABLE, the format subtitle, cached per session.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},remove(){},textContent:''};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  Object.assign(TC_SEASON,{year:2026,phase:'regular',week:2}); hasSeasonStarted=function(){return true;};
  laLoadSleeperProfile=function(){ return {username:'pottluke', user:{user_id:'me'}, leagues:[{league_id:'L1',name:'Queen City Kings'},{league_id:'L2',name:'BAFL'},{league_id:'L3',name:'Old one',stale:true},{league_id:'L5',name:'Dirty Mikes'},{league_id:'L6',name:'Business of Innovation'}]}; };
  const fetches=[];
  sleeperFetch=async(url)=>{ fetches.push(url);
    if(/league\\/L1$/.test(url)) return {name:'Queen City Kings', total_rosters:12, roster_positions:['QB','RB','WR','WR','TE','FLEX','SUPER_FLEX','BN'], scoring_settings:{rec:1}, settings:{type:0}, avatar:'abc'};
    if(/league\\/L2$/.test(url)) return {name:'BAFL', total_rosters:10, roster_positions:['QB','RB','WR','TE','FLEX','BN'], scoring_settings:{rec:0}, settings:{type:0}};
    if(/league\\/L5$/.test(url)) return {name:'Dirty Mikes', status:'pre_draft', season:'2026', total_rosters:12, roster_positions:['QB','BN'], scoring_settings:{rec:1}, settings:{type:0}};
    if(/L5\\/rosters/.test(url)) return [{roster_id:1, owner_id:'me', players:['9']}];
    if(/league\\/L6$/.test(url)) return {name:'Business of Innovation', total_rosters:8, roster_positions:['QB','RB','WR','TE','FLEX','BN'], scoring_settings:{rec:0.5}, settings:{type:0}};
    if(/L6\\/rosters/.test(url)) return [{roster_id:1, owner_id:'them', players:['1']},{roster_id:2, owner_id:'x', players:['2']}];   // I run it, I don't play in it
    if(/L1\\/rosters/.test(url)) return [{roster_id:1, owner_id:'me', players:['1','2']},{roster_id:2, owner_id:'them', players:['3']}];
    if(/L2\\/rosters/.test(url)) return [{roster_id:1, owner_id:'x', co_owners:['me'], players:['3']},{roster_id:2, owner_id:'them', players:['1']}];
    if(/users/.test(url)) return [{user_id:'me',display_name:'pottluke'},{user_id:'them',display_name:'rival',metadata:{team_name:'The Rivals'}},{user_id:'x',display_name:'partner'}];
    return [];
  };
  return { avail:pcardLeaguesAvailable, band:pcardLeaguesBandHTML, rows:pcardLeaguesRows, load:pcardLeaguesLoad, toggle:pcardLeaguesToggle, fetches, sub:pcardLeagueSub, lg:()=>_pcardLg.byLeague,
    isOpen:()=>_pcardLgOpen, setOpen:(v)=>{ _pcardLgOpen=v; }, setState:(pid)=>{ pcardState={pid:String(pid),posc:'RB',team:'NE'}; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
(async()=>{
  chk(app.avail(), 'the band exists when a Sleeper profile with leagues is saved');
  const b0=app.band('1');
  chk(/class="pcard-leagues"/.test(b0) && /pcard-lg-lbl">LEAGUES<\/span><span class="pcard-lg-txt">Availability<\/span><span class="pcard-lg-n" id="pcardLgPillTxt"><\/span>/.test(b0) && /id="pcardLgBody" hidden/.test(b0) && !/pcard-lg-row/.test(b0), 'before loading: one folded line — LEAGUES · Availability, no count yet, no rows in the card');
  chk(!/pcard-lg-pill|pcardLeaguesBarHTML/.test(code) && /\$\{contractBand\}\s*\$\{\(typeof pcardLeaguesBandHTML/.test(code) && !/pcard-hero-foot">[\s\S]{0,400}pcardLeagues/.test(code), 'the line sits under the contract band in the card\'s flow — nothing of it in the hero foot');
  await app.load(false);
  chk(app.fetches.filter(u=>/league\/L[1256]$/.test(u)).length===4 && !app.fetches.some(u=>/L3/.test(u)), 'loads each saved league once; the stale one is skipped');
  chk(app.lg().L6 && app.lg().L6.noRoster===true && app.lg().L6.myRosterId==null && app.lg().L1.noRoster===false && app.lg().L2.noRoster===false, 'a league I run without a roster of my own is marked noRoster (a co-owned roster counts as mine)');
  chk(!/Dirty Mikes/.test(app.rows('9')), 'a league that is not in play this season (never drafted) is left out');
  app.setOpen(true);
  let rows=app.rows('1');
  chk(/Queen City Kings/.test(rows) && /12-team SF PPR/.test(rows) && /★ MINE/.test(rows), 'QCK: mine, with the format subtitle');
  chk(/BAFL/.test(rows) && /10-team Standard/.test(rows) && /The Rivals/.test(rows), 'BAFL: on The Rivals (owner team name)');
  rows=app.rows('3');
  chk(/pcard-lg-mine/.test(rows.split('BAFL')[1]||''), 'a co-owned roster counts as mine');
  rows=app.rows('9');
  chk((rows.match(/AVAILABLE/g)||[]).length===3, 'an unrostered player reads AVAILABLE in every league (the card keeps the league I only run)');
  chk(/href="https:\/\/sleeper.com\/leagues\/L1\/players"/.test(rows), 'a row opens the league on Sleeper');
  const line=(pid)=>(app.band(pid).match(/id="pcardLgPillTxt">([\s\S]*?)<\/span><span class="pcard-lg-caret"/)||[])[1]||'';
  chk(line('2')==='<b>1</b> <span class="muted">of 3</span>' && line('9')==='<b>3</b> <span class="muted">of 3</span>' && line('3')==='<b>1</b> <span class="muted">of 3</span>', 'after loading the count at the right says "1 of 3" / "3 of 3" — available, of your leagues');
  // the drop-down: tap opens the rows in place under the line, tap again folds them
  app.setOpen(false); app.setState('9');
  const body=mkEl('pcardLgBody'); body.innerHTML=''; body.hidden=true;
  app.toggle('9', {stopPropagation(){}});
  chk(app.isOpen()===true && body.hidden===false && (body.innerHTML.match(/AVAILABLE/g)||[]).length===3, 'tapping the line drops the league rows down in place beneath it');
  app.toggle('9', {stopPropagation(){}});
  chk(app.isOpen()===false && body.hidden===true, 'tapping again folds them');
  // count league reads only — the in-season stats poll also goes through sleeperFetch
  const lgReads=()=>app.fetches.filter(u=>/\/league\//.test(u)).length;
  const n=lgReads(); await app.load(false);
  chk(lgReads()===n, 'a second open within the TTL fetches nothing');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
