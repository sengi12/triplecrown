// The Playbook for the season in progress on charted sets: the flag rides the sheet's data,
// groups carry the assumed split, the Scheme/Red Zone tabs name a set by its backfield, the
// sheet draws no routes and says why, and the modal subtitle says so.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){},insertAdjacentHTML(){},remove(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
const fs=require('fs'), path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { fv:_schemeBuildFv, group:_schemeToGroup, persName:_schemePersonnelName, persDetail:_schemePersonnelDetail, tpl:(t,p)=>_schemeRenderTemplate(t,p), template:()=>SCHEME_TEMPLATE_INLINE, decode:decodeSeed };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

const sig='11|gun|3|1|1|5';
const data={charting_only:true, names:{W1:'Chase'}, jerseys:{}, slots:{WR1:'W1'},
  formations:{[sig]:{p:'11',align:'gun',name:'SHOTGUN',backs:1,te:1,wr:3,ol:5,pers_assumed:true,assigns:[{slot:'WR1',name:'Chase',routes:[['GO',60],['POST',40]],src:'inf'},{slot:'TE1',name:'—',routes:[]}]}},
  views:{all:{all:{all:{total:10,groups:[{sig, n:10, share:100, pass_rate:60, epa:0.1, succ:50, np:6, sp:60, ep:0.2, nr:4, sr:40, er:-0.1, py:80, ptd:1, ry:12, rtd:0, lanes:[['RG',3,0.2]]}]}}}}};
const p={season:'2026', team:'CIN', data};

console.log('=== the flag and the groups ===');
const fv=app.fv(p);
chk(fv.charting_only===true && app.fv({season:'2025', data:{views:{}}}).charting_only===false, 'the sheet data carries charting_only only for a charted-sets season');
const g=fv.data.all.all.all.groups[0];
chk(g && g.pers_assumed===true && g.name==='SHOTGUN' && g.p==='11' && g.backs===1 && g.te===1 && g.wr===3 && g.assigns[0].routes.length===2 && g.assigns[0].src==='inf' && g.assigns[1].src==='form', 'a group expands with the estimated split flagged and the estimated routes marked inf');
chk(app.persName(g)==='11 personnel (est.)' && app.persDetail(g)==='1RB 1TE 3WR (est.)' && app.persName({p:'11',backs:1,te:1})==='11 personnel', 'the Scheme / Red Zone tabs name a charted set by its estimated personnel, a real one plainly');

console.log('=== the compact coaching file carries the flags ===');
const form=(tail, asg)=>['11|gun|3|1|1|5','SHOTGUN',1,1,3,5,asg||[['WR1',[]]]].concat(tail);
const compact=(forms,extra)=>({v:3, leg:{rt:['GO'], ln:['RG'], al:['gun']}, teams:{CIN:Object.assign({team:'CIN', slots:{WR1:'W1'}, names:{W1:'Chase'}, forms, views:{all:{all:{all:[10,[[0,10,100,60,0.1,50,6,0.2,60,-0.1,40,[[0,3,0.2]],80,1,12,0]]]}}}}, extra||{})}});
const dec=app.decode(compact([form([1], [['WR1',[[0,55]],1],['TE1',[],2]])], {co:1}));
const df=dec.CIN.formations['11|gun|3|1|1|5'];
chk(dec.CIN.charting_only===true && df.pers_assumed===true && df.assigns[0].name==='Chase' && df.assigns[0].src==='inf' && df.assigns[0].routes[0][0]==='GO' && df.assigns[1].src==='season', 'a v3 file with the appended tails decodes to charting_only + pers_assumed + route sources');
const legacy=app.decode(compact([form([])]));
chk(!legacy.CIN.charting_only && !legacy.CIN.formations['11|gun|3|1|1|5'].pers_assumed && !legacy.CIN.formations['11|gun|3|1|1|5'].assigns[0].src, 'a file without the tails (every frozen season) decodes unflagged');
const enc=fs.readFileSync(path.join(__dirname,'..','build_seed.py'),'utf8');
chk(/1 if f\.get\("pers_assumed"\) else 0\]/.test(enc) && /out_teams\[code\]\["co"\] = 1/.test(enc) && /\{"inf": 1, "szn": 2\}\.get\(a\.get\("src"\), 0\)/.test(enc), 'the encoder writes all three');

console.log('=== the sheet ===');
const tpl=app.template();
chk(/if\(FV\.charting_only\) return \{name:\(a\?a\.name:''\),list:\[\],src:'none'\}/.test(tpl), 'routesFor draws no route (and no generic tree) on a charted-sets season');
chk(/split est\. from \$\{Number\(SEASON\)-1\}/.test(tpl) && /runs \/ routes \(est\.\)/.test(tpl) && /<details class="foot"><summary>about this sheet<\/summary>/.test(tpl) && /Season in progress — charted sets/.test(tpl) && /routes are ESTIMATED/.test(tpl) && /querySelector\('\.foot > div'\)/.test(tpl) && !/\(est\)'/.test(tpl) && /const LW=54, LANE=20/.test(tpl) && /laneLast/.test(tpl), 'the card subtitle, hint and footnote say what a charted set is; routes carry no per-route tag, and labels take lanes so they do not collide');
const out=app.tpl(tpl, p);
chk(/"charting_only":true/.test(out) && /2026 · Charted sets · routes estimated/.test(out) && !/Routes mapped to players/.test(out), 'the rendered sheet ships the flag in its data script and says charted sets in its header');
chk(/if\(rf\.list && rf\.list\.length\)\{/.test(tpl) && /p\.y-14/.test(tpl), 'pass mode prints the name and skips the route text when the list is empty; the QB hint sits above the QB');
const blocks=[...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
chk(blocks.length>=2 && blocks.every(b=>{ try{ new Function(b); return true; }catch(e){ console.log('    parse error:', e.message); return false; } }), 'every script block of the rendered sheet still parses');
const src=fs.readFileSync(path.join(__dirname,'..','src/js/73-coaching-scheme.js'),'utf8');
chk(/charted sets \$\{_schemeInfoTip\('Charted sets'/.test(src) && /\$\{missingNote\}\$\{chartNote\}/.test(src), 'the modal subtitle says charted sets with the explanation behind an info button');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
