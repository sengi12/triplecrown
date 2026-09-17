// The analyzer's value lens: a dynasty league is priced on the chart (the season's games
// do not move it), a redraft league on rest-of-season worth; the VOR/Dynasty pin is kept
// PER LEAGUE so a pin never follows you into another league; the trade page says which
// basis its numbers are; and the in-season blend gives one week almost nothing.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,getBoundingClientRect:()=>({top:0}),scrollIntoView(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){},classList:{add(){},remove(){}}},addEventListener(){},visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){}; renderLeagueAnalyzer=function(){ calls.push('render'); };
  const calls=[];
  DYNASTY_VALUES={asof:'2026-08', players:{'jamarr chase':{n:"Ja'Marr Chase",pos:'WR',team:'CIN',v:89}, 'jonathan taylor':{n:'Jonathan Taylor',pos:'RB',team:'IND',v:62}}, picks:{}};
  ECR={dynasty:{'jamarr chase':{tier:1}, 'jonathan taylor':{tier:2}}};
  return { calls, laState, mode:laValMode, pin:laValPin, setPin:laSetValMode, basis:laValueBasisHTML, pinBar:laValPinBarHTML, val:laVal, dynVal:laDynVal, blend:laInSeasonBlend, POW:LA_BLEND_VALUE_POW, rosSrc:String(laRosValueMap),
    trade:laTradeView, setSnapshot:(s)=>{leagueSnapshot=s;}, setStarted:(b)=>{ hasSeasonStarted=()=>b; } };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const snap=(id,type)=>({provider:'sleeper', leagueId:id, season:'2026', seasonChain:[{season:'2026'}], leagueType:type, myUserId:'u1', rosterPositions:['QB','RB','WR','TE','BN'],
  teamList:[{rosterId:1, ownerId:'u1', teamName:'Me', players:[{id:'1',name:"Ja'Marr Chase",pos:'WR',team:'CIN'},{id:'2',name:'Jonathan Taylor',pos:'RB',team:'IND'}], picks:[]},
            {rosterId:2, ownerId:'u2', teamName:'Them', players:[], picks:[]}]});

console.log('=== a dynasty league prices on the chart, whatever week 1 said ===');
app.setStarted(true);
app.setSnapshot(snap('DYN', 2));
chk(app.mode()==='dynasty' && app.pin()==='auto', 'Sleeper type 2 → the dynasty chart, unpinned');
chk(app.dynVal("Ja'Marr Chase",'WR')===Math.round(89*100*1.15) && app.dynVal('Jonathan Taylor','RB')===Math.round(62*100*1.08) && app.val("Ja'Marr Chase",'WR')>app.val('Jonathan Taylor','RB'), 'Chase (89, tier 1) is worth more than Taylor (62, tier 2) — the chart, with the tier boost, and no game in it');
app.setSnapshot(snap('RED', 0));
chk(app.mode()==='redraft', 'type 0 → rest-of-season value');
app.setSnapshot(snap('CHOP', 3));
chk(app.mode()==='redraft', 'a chopped league too');
app.setSnapshot(snap('KEEP', 1));
chk(app.mode()==='dynasty', 'a keeper league keeps the chart unless pinned');

console.log('=== the pin is per league ===');
app.setSnapshot(snap('KEEP', 1)); app.setPin('redraft');
chk(app.mode()==='redraft' && app.pin()==='redraft' && app.calls.includes('render'), 'pinned to VOR in the keeper league');
app.setSnapshot(snap('DYN', 2));
chk(app.mode()==='dynasty' && app.pin()==='auto', 'the dynasty league is NOT pinned by it — the pin stays with the keeper league');
app.setSnapshot(snap('KEEP', 1));
chk(app.pin()==='redraft', 'and is still there when you come back');
app.setPin('auto');
chk(app.pin()==='auto' && app.mode()==='dynasty' && !app.laState.valModeBy.KEEP, 'Auto clears it');
app.setSnapshot(snap('DYN', 2)); app.setPin('redraft');
chk(app.mode()==='redraft', 'a dynasty league can still be pinned to VOR on purpose');
app.setPin('auto');

console.log('=== the trade page says what its numbers are ===');
app.setSnapshot(snap('DYN', 2));
let h=app.trade(snap('DYN', 2));
chk(/<div class="la-basis-row"><span class="la-basis"[^>]*>dynasty chart · 2026-08<\/span>/.test(h) && /class="format-btn active" onclick="laSetValMode\('auto'\)">Auto \(dynasty\)</.test(h), 'the trade calculator heads with "dynasty chart · 2026-08" and the lens pin (Auto = dynasty)');
chk(/The season’s games do not move these/.test(h), 'and its tooltip says the games do not move it');
app.setSnapshot(snap('RED', 0));
h=app.trade(snap('RED', 0));
chk(/la-basis"[^>]*>rest-of-season value<\/span>/.test(h) && !/la-valmode/.test(h), 'a redraft league heads with "rest-of-season value" and offers no pin (there is nothing to pin)');
app.setSnapshot(snap('DYN', 2)); app.setPin('redraft');
h=app.trade(snap('DYN', 2));
chk(/rest-of-season value<span class="la-basis-pin">pinned<\/span>/.test(h), 'a pinned dynasty league says so beside the basis');
app.setPin('auto');
chk(/rest-of-season value|dynasty chart/.test(app.basis()) && /Value:/.test(app.pinBar()), 'the same basis tag and pin bar are what the Compare tab shows');

console.log('=== the in-season blend: one week is noise in a player\'s VALUE ===');
const b=app.blend, POW=app.POW;
chk(POW===2 && Math.abs(b(20, 40, null, 1, POW)-(0.974*20+0.026*40))<1e-9, 'one 40-point opener on a 20/g projection: 20.5 of rest-of-season worth, not 22.6');
chk(Math.abs(b(20, 40, 40, 3, POW)-((1-0.234)*20+0.234*40))<1e-9 && Math.abs(b(20, 40, 40, 5, POW)-(0.35*20+0.65*40))<1e-9, 'three such games: 24.7; five: the full 35/65 split');
chk(b(20, 40, 40, 12, POW)===b(20, 40, 40, 5, POW), 'and it never exceeds the five-game share');
chk(Math.abs(b(20, 40, null, 1)-(0.87*20+0.13*40))<1e-9, 'this week\'s projection and the wire keep the linear ramp (13% after one game): a role change shows in one game\'s usage');
chk(/laInSeasonBlend\(base, seas, rec3, gp, \(typeof LA_BLEND_VALUE_POW/.test(app.rosSrc), 'rest-of-season worth (the trade and redraft lenses) is what takes the squared ramp');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
