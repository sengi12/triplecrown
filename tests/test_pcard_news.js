// Player card · News tab: Sleeper's per-player feed (Rotowire / FantasyPros) as the card's
// own tab — there only once the feed has notes (the card still opens on the stats), each
// note in full: headline, age and source, description, analysis, source link. Fetched once
// per open, kept ten minutes; a D/ST (non-numeric id) has none; a failed fetch → no tab.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  const fetches=[];
  const NOW=Date.now();   // the fixture's stamps are relative to the real clock, so ages read the same in the tab
  const RAW=[
    {metadata:{title:'Breece Hall finds the end zone in Week 1 win', description:'Breece Hall carried the ball 22 times for 102 yards and a touchdown.', analysis:'He will slot in as a solid RB1.', url:'https://www.fantasypros.com/nfl/news/607650/x.php', topic_id:'1'}, source:'fantasy_pros', player_id:'8155', published:NOW-2*3600*1000},
    {metadata:{title:'Breece Hall - Practices in full <b>', description:'Hall (groin) practiced in full.', analysis:'', topic_id:'2'}, source:'rotowire', player_id:'8155', published:NOW-3*86400*1000},
    {metadata:{title:'', description:'no headline'}, source:'rotowire', published:NOW},
  ];
  let mode='ok';
  sleeperFetch=async(url)=>{ fetches.push(url); if(mode==='fail') throw new Error('502'); return RAW; };
  pcardRoutesAvailable=()=>false; pcardQbPassingAvailable=()=>false; pcardQbOlAvailable=()=>false; pcardRbFanAvailable=()=>false; pcardOlAvailable=()=>false;
  return { avail:pcardNewsAvailable, render:renderPcardNews, load:pcardNewsLoad, items:pcardNewsItems, ago:(ms)=>pcardNewsAgo(ms, NOW), src:pcardNewsSource, norm:pcardNewsNorm,
    tabs:()=>{ renderPcardStatTabs(); return document.getElementById('pcardTabs').innerHTML; }, setMode:(m)=>{ pcardStatsMode=m; }, loadStats:pcardLoadStats,
    fetches, NOW, fail:(m)=>{ mode=m; }, setState:(pid,posc)=>{ pcardState={pid:String(pid),posc:posc||'RB',team:'NYJ',isSkill:true}; }, store:()=>_pcardNews, reset:()=>{ _pcardNews={}; },
    body:()=>document.getElementById('pcardBody').innerHTML };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

(async()=>{
  console.log('=== the pieces ===');
  chk(app.ago(app.NOW-5*60*1000)==='5m ago' && app.ago(app.NOW-2*3600*1000)==='2h ago' && app.ago(app.NOW-3*86400*1000)==='3d ago' && app.ago(0)==='', 'ages read 5m / 2h / 3d ago; no stamp, no age');
  chk(app.src('rotowire')==='Rotowire' && app.src('fantasy_pros')==='FantasyPros' && app.src('some_site')==='Some Site' && app.src('')==='', 'sources are named the way the Sleeper app names them');
  chk(app.norm({metadata:{title:''}})===null && app.norm({metadata:{title:'T', url:'javascript:alert(1)'}}).url==='' && app.norm({metadata:{title:'T', url:'https://x.y/z'}, source:'rotowire', published:5}).at===5, 'a note needs a headline; only an http(s) source link survives');
  chk(app.avail('DET')===false && app.avail('')===false && app.fetches.length===0, 'a D/ST card (a team code, not a player id) gets no tab and no fetch');

  console.log('=== the tab ===');
  app.setState('8155'); app.setMode('pro');
  let tabs=app.tabs();
  chk(/>NFL</.test(tabs) && /College/.test(tabs) && !/>News</.test(tabs) && app.fetches.length===1 && /players\/nfl\/8155\/news\?limit=5/.test(app.fetches[0]), 'first render: NFL and College, no News tab yet — and the feed is fetched (newest five)');
  const items=await app.load('8155');
  chk(items.length===2 && items[0].title.startsWith('Breece Hall finds') && items[1].source==='Rotowire', 'the feed lands: two notes (the one without a headline dropped), newest first');
  tabs=document.getElementById('pcardTabs').innerHTML;
  chk(/setPcardStatsMode\('news'\)">News<\/button>$/.test(tabs) && /class="pcard-tab active" onclick="setPcardStatsMode\('pro'\)"/.test(tabs), 'the tab row repainted itself with a News tab at the end; NFL stays selected');
  app.setMode('news'); app.loadStats('news');
  const h=app.body();
  chk((h.match(/<article class="pcard-news-it">/g)||[]).length===2, 'the News tab: one article per note');
  chk(/<div class="pcard-news-h">Breece Hall finds the end zone in Week 1 win<\/div>\s*<div class="pcard-news-m">2h ago · via FantasyPros<\/div>/.test(h), 'a note: the headline, then when and where from');
  chk(/<p class="pcard-news-d">Breece Hall carried the ball 22 times[^<]*<\/p>\s*<p class="pcard-news-a">He will slot in as a solid RB1\.<\/p>\s*<a class="pcard-news-src" href="https:\/\/www\.fantasypros\.com\/nfl\/news\/607650\/x\.php" target="_blank" rel="noopener">source ↗<\/a>/.test(h), 'the description, the analysis, the source link');
  chk(/Practices in full &lt;b&gt;<\/div>/.test(h) && !/<b>/.test(h) && /3d ago · via Rotowire/.test(h) && !/pcard-news-a/.test(h.split('Practices in full')[1]), 'markup in a headline is escaped; no analysis, no paragraph for it');
  const n=app.fetches.length; app.tabs();
  chk(app.fetches.length===n && /News/.test(document.getElementById('pcardTabs').innerHTML), 'rendering again within ten minutes: the tab from the cache, no fetch');
  app.store()['8155'].at=app.NOW-1e12;   // long stale
  app.tabs();
  chk(app.fetches.length===n+1, 'past the TTL the next render refetches (the tab stays meanwhile)');
  await app.load('8155');

  console.log('=== when the feed fails or is empty ===');
  app.reset(); app.fail('fail'); app.setState('4034'); app.setMode('pro');
  app.tabs(); const failed=await app.load('4034');
  chk(failed.length===0 && !/News/.test(document.getElementById('pcardTabs').innerHTML) && /No news for him yet/.test(app.render('4034')), 'a failed (or empty) feed: no News tab, and the tab body would say so');

  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
