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
  laLoadSleeperProfile=function(){ return {username:'pottluke', user:{user_id:'me'}, leagues:[{league_id:'L1',name:'Queen City Kings'},{league_id:'L2',name:'BAFL'},{league_id:'L3',name:'Old one',stale:true}]}; };
  const fetches=[];
  sleeperFetch=async(url)=>{ fetches.push(url);
    if(/league\\/L1$/.test(url)) return {name:'Queen City Kings', total_rosters:12, roster_positions:['QB','RB','WR','WR','TE','FLEX','SUPER_FLEX','BN'], scoring_settings:{rec:1}, settings:{type:0}, avatar:'abc'};
    if(/league\\/L2$/.test(url)) return {name:'BAFL', total_rosters:10, roster_positions:['QB','RB','WR','TE','FLEX','BN'], scoring_settings:{rec:0}, settings:{type:0}};
    if(/L1\\/rosters/.test(url)) return [{roster_id:1, owner_id:'me', players:['1','2']},{roster_id:2, owner_id:'them', players:['3']}];
    if(/L2\\/rosters/.test(url)) return [{roster_id:1, owner_id:'x', co_owners:['me'], players:['3']},{roster_id:2, owner_id:'them', players:['1']}];
    if(/users/.test(url)) return [{user_id:'me',display_name:'pottluke'},{user_id:'them',display_name:'rival',metadata:{team_name:'The Rivals'}},{user_id:'x',display_name:'partner'}];
    return [];
  };
  return { avail:pcardLeaguesAvailable, bar:pcardLeaguesBarHTML, rows:pcardLeaguesRows, load:pcardLeaguesLoad, toggle:pcardLeaguesToggle, fetches, sub:pcardLeagueSub,
    setOpen:(v)=>{ _pcardLgOpen=v; }, setState:(pid)=>{ pcardState={pid:String(pid),posc:'RB',team:'NE'}; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
(async()=>{
  chk(app.avail(), 'the band exists when a Sleeper profile with leagues is saved');
  chk(/pcard-lg-pill/.test(app.bar('1')) && /id="pcardLgPillTxt"><\/span>/.test(app.bar('1')) && !/pcard-lg-row/.test(app.bar('1')), 'before loading: the icon alone, no rows in the card');
  await app.load(false);
  chk(app.fetches.filter(u=>/league\/L[12]$/.test(u)).length===2 && !app.fetches.some(u=>/L3/.test(u)), 'loads each live league once; the stale one is skipped');
  app.setOpen(true);
  let rows=app.rows('1');
  chk(/Queen City Kings/.test(rows) && /12-team SF PPR/.test(rows) && /★ MINE/.test(rows), 'QCK: mine, with the format subtitle');
  chk(/BAFL/.test(rows) && /10-team Standard/.test(rows) && /The Rivals/.test(rows), 'BAFL: on The Rivals (owner team name)');
  rows=app.rows('3');
  chk(/pcard-lg-mine/.test(rows.split('BAFL')[1]||''), 'a co-owned roster counts as mine');
  rows=app.rows('9');
  chk((rows.match(/AVAILABLE/g)||[]).length===2, 'an unrostered player reads AVAILABLE in every league');
  chk(/href="https:\/\/sleeper.com\/leagues\/L1\/players"/.test(rows), 'a row opens the league on Sleeper');
  chk(/>1 of 2</.test(app.bar('2')) && />2 of 2</.test(app.bar('9')) && />0 of 2</.test(app.bar('3')), 'after loading the pill says "1 of 2" / "2 of 2" / "0 of 2" — available, of your leagues');
  const n=app.fetches.length; await app.load(false);
  chk(app.fetches.length===n, 'a second open within the TTL fetches nothing');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
