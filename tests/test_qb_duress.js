// The passing chart's Under Duress panel: a game's dropbacks split by what the defense did
// (clean pocket / hit-or-sacked / vs blitz) with the passer rating of each, plus PFR's
// pressure counts; season-to-date sums when no game is picked, recomputing the rating from
// the summed components.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},classList:{add(){},remove(){}}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { panel:pcardQbDuressHTML, sum:_qbDuressSum, rating:_qbRatingOf };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

chk(app.rating(30,20,250,2,1)===Number((( (20/30-0.3)*5 + (250/30-3)*0.25 + Math.min(2.375,2/30*20) + Math.max(0,2.375-1/30*25) )/6*100).toFixed(1)), 'the passer rating formula, recomputed from components');
chk(app.rating(0,0,0,0,0)===null, 'no attempts → no rating');

const g1={wk:1, opp:'SF', duress:{ clean:{db:24,att:22,cmp:16,yds:210,td:2,int:0,sk:0,rating:112.3}, pressured:{db:8,att:5,cmp:1,yds:9,td:0,int:1,sk:3,rating:2.5}, blitzed:{db:9,att:8,cmp:5,yds:70,td:1,int:0,sk:1,rating:104.2},
  pfr:{pressured:6,pressured_pct:18.8,blitzed:9,hurried:0,hit:3,sacked:3,bad_throws:4,bad_throw_pct:14.3,drops:2} }};
const g2={wk:2, opp:'NYG', duress:{ clean:{db:30,att:30,cmp:22,yds:280,td:3,int:0,sk:0,rating:120.1}, pressured:null, blitzed:{db:4,att:4,cmp:2,yds:20,td:0,int:0,sk:0,rating:60.4}, pfr:null }};
const np={name:'Matthew Stafford',team:'LAR',pos:'QB'};

console.log('=== one game ===');
let h=app.panel(g1,[g1,g2],'2026',np);
chk(/UNDER DURESS · WK 1 vs SF/.test(h) && /32 dropbacks/.test(h), 'the header names the game and counts its dropbacks');
chk(/<th[^>]*>Hit or sacked<\/th><td>1\/5<\/td><td class="dz-pct">20%<\/td><td>9<\/td><td>0<\/td><td>1<\/td><td>3<\/td><td><b>2\.5<\/b>/.test(h), 'hit-or-sacked: 1/5, 20%, 9 yds, 0 TD, 1 INT, 3 sacks, rating 2.5');
chk(/Clean pocket<\/th><td>16\/22/.test(h) && /vs Blitz \(5\+\)<\/th><td>5\/8/.test(h), 'the clean and vs-blitz lines');
chk(/PFR: pressured <b>6<\/b> <span class="qpc-dz-pct">\(18\.8% of dropbacks\)<\/span> · blitzed <b>9<\/b> · hurried <b>0<\/b> · hit <b>3<\/b> · sacked <b>3<\/b> · bad throws <b>4<\/b> · drops <b>2<\/b>/.test(h), 'PFR\'s pressure line with its own pressure rate');
h=app.panel(g2,[g1,g2],'2026',np);
chk(/qpc-dz-none"><th[^>]*>Hit or sacked<\/th><td colspan="7">none<\/td>/.test(h) && /PFR's pressure counts \(hurries included\) post within a day/.test(h), 'a game with no pressured dropback says none; PFR not posted yet says so');

console.log('=== season to date ===');
const s=app.sum([g1,g2],'pressured');
chk(s.db===8 && s.att===5 && s.cmp===1 && s.sk===3 && s.rating===app.rating(5,1,9,0,1), 'a split missing in one game still sums the games that have it');
const c=app.sum([g1,g2],'clean');
chk(c.db===54 && c.cmp===38 && c.att===52 && c.rating===app.rating(52,38,490,5,0), 'the season line recomputes the rating from the summed components, not an average of ratings');
h=app.panel(null,[g1,g2],'2026',np);
chk(/UNDER DURESS · SEASON TO DATE/.test(h) && /62 dropbacks/.test(h) && /Clean pocket<\/th><td>38\/52/.test(h), 'no game picked: season to date');
chk(/PFR: pressured <b>6<\/b> <span class="qpc-dz-pct">\(9\.7% of dropbacks\)/.test(h), 'PFR counts summed over the games that have them, the rate over our dropbacks');
chk(app.panel(null,[{wk:1,opp:'X'}],'2026',np)==='' && app.panel({wk:1,opp:'X'},[],'2026',np)==='', 'a sidecar built before the splits → no panel');
const g3={wk:1, opp:'TB', duress:{ clean:{db:30,att:30,cmp:20,yds:250,td:2,int:0,sk:0,rating:100}, pressured:null, blitzed:null, pfr:null }};
chk(/vs Blitz \(5\+\)<\/th><td colspan="7">FTN charting not posted yet<\/td>/.test(app.panel(g3,[g3],'2026',np)), 'no blitz charting yet reads as not posted, not as zero blitzes');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
