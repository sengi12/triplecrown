// The Leaders sidebar: Sleeper's week rows ranked by fantasy points under the loaded scoring,
// a position filter with Rookie, the current week by default with any week or the season from
// a dropdown, shortened names, points in bold — desktop and in season only.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',hidden:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};return elStore[id];}
const main={appendChild(el){ elStore[el.id]=el; }};
global.document={getElementById:(id)=>mkEl(id),querySelector:(q)=>q==='.main'?main:null,querySelectorAll:()=>[],createElement:()=>({id:'',className:'',innerHTML:'',hidden:false,style:{},classList:{add(){},remove(){}},appendChild(){}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){},visibilityState:'visible'};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  const W={ 1:{QB:[{player_id:'q1',team:'CHI',position:'QB',player:{first_name:'Caleb',last_name:'Williams'},stats:{gp:1,pass_yd:300,pass_td:3,pass_int:1}},
                 {player_id:'q2',team:'NE',position:'QB',player:{first_name:'Drake',last_name:'Maye'},stats:{gp:1,pass_yd:180,pass_td:1,pass_int:2}}],
             RB:[{player_id:'r1',team:'SEA',position:'RB',player:{first_name:'Kenneth',last_name:'Walker'},stats:{gp:1,rush_yd:120,rush_td:2,rec:3,rec_yd:20}}],
             WR:[{player_id:'w1',team:'SEA',position:'WR',player:{first_name:'Jaxon',last_name:'Smith-Njigba'},stats:{gp:1,rec:8,rec_yd:122,rec_td:1}}],
             TE:[{player_id:'t1',team:'LV',position:'TE',player:{first_name:'Brock',last_name:'Bowers'},stats:{gp:1,rec:2,rec_yd:14}}] },
          2:{QB:[{player_id:'q2',team:'NE',position:'QB',player:{first_name:'Drake',last_name:'Maye'},stats:{gp:1,pass_yd:350,pass_td:4}}], RB:[], WR:[], TE:[]} };
  let fetches=[];
  fetchWeekStats=async(season,wk,pos)=>{ fetches.push(wk+':'+pos); return (W[wk]||{})[pos]||[]; };
  liveSeasonRowsThroughWeek=async(season,wk)=>{ fetches.push('season:'+wk); return [{player_id:'q2',team:'NE',position:'QB',player:{first_name:'Drake',last_name:'Maye'},stats:{gp:2,pass_yd:530,pass_td:5,pass_int:2}},{player_id:'w1',team:'SEA',position:'WR',player:{first_name:'Jaxon',last_name:'Smith-Njigba'},stats:{gp:1,rec:8,rec_yd:122,rec_td:1}}]; };
  sleeperPlayers={q1:{years_exp:0}, q2:{years_exp:1}, r1:{years_exp:2}, w1:{years_exp:2}, t1:{years_exp:0}};
  hasSeasonStarted=()=>true; TC_SEASON.year=2026; TC_SEASON.phase='regular'; TC_SEASON.week=2;
  let mobile=false; isMobileTeamPickerLayout=()=>mobile;
  return { render:renderLeaders, html:()=>document.getElementById('leaders').innerHTML, hidden:()=>document.getElementById('leaders').hidden, setPos:ldSetPos, setWeek:ldSetWeek,
    fetches:()=>fetches, setMobile:(v)=>{ mobile=v; }, setStarted:(v)=>{ hasSeasonStarted=()=>v; }, TC_SEASON, short:ldShortName, scoring:scoringSettings,
    setWidth:(px)=>{ document.getElementById('leaders').style.width=px+'px'; }, sort:ldSort, cols:ldColsFor, state:()=>_ld };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const settle=()=>new Promise(r=>setTimeout(r,15));
(async()=>{
  console.log('=== the current week, ranked under the loaded scoring ===');
  app.render(); await settle();
  let h=app.html();
  chk(!app.hidden() && /Leaders/.test(h) && /<option value="current" selected>Week 2 · now<\/option>/.test(h) && /<option value="1"/.test(h) && /<option value="season"/.test(h), 'in season on a desktop: the current week by default, every week and the season in the dropdown');
  chk(app.fetches().filter(f=>/^2:/.test(f)).length===4, 'Sleeper week rows pulled per position (QB/RB/WR/TE)');
  chk(/ld-row/.test(h) && /ld-hs" src="https:\/\/sleepercdn\.com\/content\/nfl\/players\/q2\.jpg"/.test(h) && /<b class="ld-pts">/.test(h), 'rows carry a Sleeper headshot and the points in bold');
  chk(/ld-nm">D\. Maye</.test(h), 'names are shortened (Drake Maye → D. Maye)');
  chk(app.short('Jaxon Smith-Njigba').startsWith('J.') && app.short('Caleb Williams')==='C. Williams', 'the shortener');
  const order=[...h.matchAll(/ld-nm">([^<]+)</g)].map(m=>m[1]);
  chk(order[0]==='D. Maye' && order.length===1, 'week 2 has one finish so far; week 1 is not mixed in');

  console.log('=== another week, the filters, the season ===');
  app.setWeek('1'); await settle(); h=app.html();
  const o1=[...h.matchAll(/ld-nm">([^<]+)</g)].map(m=>m[1]);
  const pts=[...h.matchAll(/ld-pts">([\d.]+)</g)].map(m=>+m[1]);
  chk(o1.length===5 && pts.every((p,i)=>i===0||p<=pts[i-1]), `week 1: five finishes, sorted by points (${o1.join(', ')})`);
  chk(o1[0]==='K. Walker' || o1[0]==='C. Williams', 'the top finish is the big game, under the loaded scoring');
  app.setPos('WR'); h=app.html();
  chk((h.match(/ld-row/g)||[]).length===1 && /J\. Smith-Njigba/.test(h) && /ld-pos active"[^>]*>WR</.test(h), 'the WR filter keeps only receivers');
  app.setPos('ROOKIE'); h=app.html();
  const rk=[...h.matchAll(/ld-nm">([^<]+)</g)].map(m=>m[1]);
  chk(rk.length===2 && rk.includes('C. Williams') && rk.includes('B. Bowers'), 'Rookie = first-year players (years_exp 0)');
  app.setPos('ALL'); app.setWeek('season'); await settle(); h=app.html();
  chk(app.fetches().some(f=>f==='season:2') && /<option value="season" selected>/.test(h) && /D\. Maye/.test(h), 'season-long sums the weeks (the same builder the Live view uses)');
  const sp=[...h.matchAll(/ld-pts">([\d.]+)</g)].map(m=>+m[1]);
  chk(sp[0]>pts[0] || sp[0]>30, `season points exceed a single week (${sp[0]})`);

  console.log('=== the list grows with the sidebar: full names, then stat columns, sortable ===');
  app.setPos('ALL'); app.setWeek('1'); await settle();
  app.setWidth(200); app.render(true); h=app.html();
  chk(/ld-nm">C\. Williams</.test(h) && !/ld-col/.test(h) && !/ld-hdr/.test(h), 'at 200px: short names, no columns, no header');
  app.setWidth(300); app.render(true); h=app.html();
  chk(/ld-nm">Caleb Williams</.test(h) && !/ld-col/.test(h), 'at 300px the names fill out (Caleb Williams) — still no columns');
  chk(app.cols(300).length===0 && app.cols(408).length===2 && app.cols(700).length===6, 'one column per 64px past the full-name width, up to the position\'s set');
  app.setWidth(408); app.render(true); h=app.html();
  chk(/ld-hdr/.test(h) && /ldSort\('tot_yd'\)[^>]*>TOT YD</.test(h) && /ldSort\('tot_td'\)[^>]*>TOT TD</.test(h) && !/PASS YD/.test(h), 'at 408px on ALL: a header with TOT YD and TOT TD, sortable, nothing more yet');
  chk(/ld-colh active"[^>]*>PTS</.test(h), 'points is the sort by default');
  app.setPos('QB'); h=app.html();
  chk(/PASS YD/.test(h) && /PASS TD/.test(h) && !/TOT YD/.test(h) && /ld-col[^>]*>300</.test(h), 'QB: the position\'s own columns (PASS YD, PASS TD) with the numbers');
  app.sort('pass_yd'); h=app.html();
  let qo=[...h.matchAll(/ld-nm">([^<]+)</g)].map(m=>m[1]);
  chk(qo[0]==='Caleb Williams' && /ldSort\('pass_yd'\)[^>]*class="ld-col ld-colh active"|ld-col ld-colh active"[^>]*>PASS YD</.test(h), 'clicking PASS YD sorts by it (Williams 300 over Maye 180) and lights the header');
  app.sort('pass_int'); app.setWidth(600); app.render(true); h=app.html();
  qo=[...h.matchAll(/ld-nm">([^<]+)</g)].map(m=>m[1]);
  chk(qo[0]==='Drake Maye' && /CMP\/ATT/.test(h), 'wider still: more columns (CMP/ATT); sorted by INT puts Maye (2) first');
  app.sort('pass_int'); h=app.html();
  chk(app.state().sort==='pts' && /ld-colh active"[^>]*>PTS</.test(h), 'clicking the active column again returns to points');
  app.setPos('WR'); h=app.html();
  chk(/TGT/.test(h) && /REC YD/.test(h) && !/PASS YD/.test(h), 'WR: targets, receptions, receiving yards');
  app.setWidth(200); app.setPos('ALL');

  console.log('=== where it does not belong ===');
  app.setMobile(true); app.render();
  chk(app.hidden()===true, 'phones: hidden (the picker owns that space)');
  app.setMobile(false); app.setStarted(false); app.render();
  chk(app.hidden()===true, 'off-season: hidden');
  app.setStarted(true); app.render();
  chk(app.hidden()===false, 'back in season on a desktop: shown');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
