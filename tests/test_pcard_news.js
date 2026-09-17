// Player card · Latest news: Sleeper's per-player feed (Rotowire / FantasyPros) as collapsed
// rows — headline, age, source; the description, the analysis and the source link on tap.
// Fetched once per open, kept ten minutes; a D/ST (non-numeric id) has none; a failed
// fetch leaves an empty, hidden band.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  const fetches=[];
  const NOW=Date.now();   // the fixture's stamps are relative to the real clock, so ages read the same in the band
  const RAW=[
    {metadata:{title:'Breece Hall finds the end zone in Week 1 win', description:'Breece Hall carried the ball 22 times for 102 yards and a touchdown.', analysis:'He will slot in as a solid RB1.', url:'https://www.fantasypros.com/nfl/news/607650/x.php', topic_id:'1'}, source:'fantasy_pros', player_id:'8155', published:NOW-2*3600*1000},
    {metadata:{title:'Breece Hall - Practices in full <b>', description:'Hall (groin) practiced in full.', analysis:'', topic_id:'2'}, source:'rotowire', player_id:'8155', published:NOW-3*86400*1000},
    {metadata:{title:'', description:'no headline'}, source:'rotowire', published:NOW},
  ];
  let mode='ok';
  sleeperFetch=async(url)=>{ fetches.push(url); if(mode==='fail') throw new Error('502'); return RAW; };
  return { html:pcardNewsHTML, body:pcardNewsBodyHTML, load:pcardNewsLoad, items:pcardNewsItems, ago:(ms)=>pcardNewsAgo(ms, NOW), src:pcardNewsSource, norm:pcardNewsNorm,
    fetches, NOW, setMode:(m)=>{ mode=m; }, setState:(pid)=>{ pcardState={pid:String(pid),posc:'RB',team:'NYJ'}; }, store:()=>_pcardNews, reset:()=>{ _pcardNews={}; },
    el:()=>document.getElementById('pcardNews') };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

(async()=>{
  console.log('=== the pieces ===');
  chk(app.ago(app.NOW-5*60*1000)==='5m' && app.ago(app.NOW-2*3600*1000)==='2h' && app.ago(app.NOW-3*86400*1000)==='3d' && app.ago(0)==='', 'ages read 5m / 2h / 3d; no stamp, no age');
  chk(app.src('rotowire')==='Rotowire' && app.src('fantasy_pros')==='FantasyPros' && app.src('some_site')==='Some Site' && app.src('')==='', 'sources are named the way the Sleeper app names them');
  chk(app.norm({metadata:{title:''}})===null && app.norm({metadata:{title:'T', url:'javascript:alert(1)'}}).url==='' && app.norm({metadata:{title:'T', url:'https://x.y/z'}, source:'rotowire', published:5}).at===5, 'a note needs a headline; only an http(s) source link survives');
  chk(app.html('DET')==='' && app.html('')==='', 'a D/ST card (a team code, not a player id) gets no band');

  console.log('=== the band ===');
  app.setState('8155');
  const first=app.html('8155');
  chk(first==='<div class="pcard-news" id="pcardNews"></div>' && app.fetches.length===1 && /players\/nfl\/8155\/news\?limit=3/.test(app.fetches[0]), 'first open: an empty band, one fetch of the newest three');
  const items=await app.load('8155');
  chk(items.length===2 && items[0].title.startsWith('Breece Hall finds') && items[1].source==='Rotowire', 'the feed lands: two notes (the one without a headline dropped), newest first');
  const h=app.body(items);
  chk(/pcard-news-lbl">News<\/div>/.test(h) && (h.match(/<details class="pcard-news-it">/g)||[]).length===2, 'a label and a collapsed row per note');
  chk(/<span class="pcard-news-h">Breece Hall finds the end zone in Week 1 win<\/span><span class="pcard-news-m">2h · FantasyPros<\/span>/.test(h), 'a row: the headline, then age and source');
  chk(/<p>Breece Hall carried the ball 22 times[^<]*<\/p><p class="pcard-news-a">He will slot in as a solid RB1\.<\/p><a href="https:\/\/www\.fantasypros\.com\/nfl\/news\/607650\/x\.php" target="_blank" rel="noopener">source ↗<\/a>/.test(h), 'opened: the description, the analysis, the source link');
  chk(/Practices in full &lt;b&gt;<\/span>/.test(h) && !/<b>/.test(h) && /3d · Rotowire/.test(h) && !/pcard-news-a/.test(h.split('Practices in full')[1]), 'markup in a headline is escaped; no analysis, no paragraph for it');
  chk(app.el().innerHTML===h, 'the band on the open card repainted itself when the feed landed');
  chk(app.html('8155')===`<div class="pcard-news" id="pcardNews">${h}</div>` && app.fetches.length===1, 'reopening within ten minutes renders from the cache, no fetch');
  app.store()['8155'].at=app.NOW-11*60*1000-1e12;   // long stale
  app.html('8155');
  chk(app.fetches.length===2, 'past the TTL the next open refetches (and shows the old notes meanwhile)');
  await app.load('8155');

  console.log('=== when the feed fails ===');
  app.reset(); app.setMode('fail'); app.setState('4034');
  app.html('4034'); const failed=await app.load('4034');
  chk(failed.length===0 && app.html('4034')==='<div class="pcard-news" id="pcardNews"></div>', 'a failed fetch leaves the band empty (hidden by CSS) and does not throw');

  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
