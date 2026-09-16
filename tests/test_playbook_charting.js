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

const sig='1B|gun|3|1|1|5';
const data={charting_only:true, names:{W1:'Chase'}, jerseys:{}, slots:{WR1:'W1'},
  formations:{[sig]:{p:'1B',align:'gun',name:'SHOTGUN',backs:1,te:1,wr:3,ol:5,pers_assumed:true,assigns:[{slot:'WR1',name:'Chase',routes:[]},{slot:'TE1',name:'—',routes:[]}]}},
  views:{all:{all:{all:{total:10,groups:[{sig, n:10, share:100, pass_rate:60, epa:0.1, succ:50, np:6, sp:60, ep:0.2, nr:4, sr:40, er:-0.1, py:80, ptd:1, ry:12, rtd:0, lanes:[['RG',3,0.2]]}]}}}}};
const p={season:'2026', team:'CIN', data};

console.log('=== the flag and the groups ===');
const fv=app.fv(p);
chk(fv.charting_only===true && app.fv({season:'2025', data:{views:{}}}).charting_only===false, 'the sheet data carries charting_only only for a charted-sets season');
const g=fv.data.all.all.all.groups[0];
chk(g && g.pers_assumed===true && g.name==='SHOTGUN' && g.p==='1B' && g.backs===1 && g.te===1 && g.wr===3 && g.assigns[0].routes.length===0, 'a group expands with the assumed split flagged and no routes');
chk(app.persName(g)==='1-back sets' && app.persDetail(g)==='1RB · charted set' && app.persName({p:'11',backs:1,te:1})==='11 personnel', 'the Scheme / Red Zone tabs name a charted set by its backfield, a real one by personnel');

console.log('=== the compact coaching file carries the flags ===');
const form=(tail)=>['1B|gun|3|1|1|5','SHOTGUN',1,1,3,5,[['WR1',[]]]].concat(tail);
const compact=(forms,extra)=>({v:3, leg:{rt:[], ln:['RG'], al:['gun']}, teams:{CIN:Object.assign({team:'CIN', slots:{WR1:'W1'}, names:{W1:'Chase'}, forms, views:{all:{all:{all:[10,[[0,10,100,60,0.1,50,6,0.2,60,-0.1,40,[[0,3,0.2]],80,1,12,0]]]}}}}, extra||{})}});
const dec=app.decode(compact([form([1])], {co:1}));
chk(dec.CIN.charting_only===true && dec.CIN.formations['1B|gun|3|1|1|5'].pers_assumed===true && dec.CIN.formations['1B|gun|3|1|1|5'].assigns[0].name==='Chase', 'a v3 file with the appended tail decodes to charting_only + pers_assumed');
const legacy=app.decode(compact([form([])]));
chk(!legacy.CIN.charting_only && !legacy.CIN.formations['1B|gun|3|1|1|5'].pers_assumed, 'a file without the tail (every frozen season) decodes unflagged');
const enc=fs.readFileSync(path.join(__dirname,'..','build_seed.py'),'utf8');
chk(/1 if f\.get\("pers_assumed"\) else 0\]/.test(enc) && /out_teams\[code\]\["co"\] = 1/.test(enc), 'the encoder writes both');

console.log('=== the sheet ===');
const tpl=app.template();
chk(/if\(FV\.charting_only\) return \{name:\(a\?a\.name:''\),list:\[\],src:'none'\}/.test(tpl), 'routesFor draws no route (and no generic tree) on a charted-sets season');
chk(/g\.pers_assumed\?`\$\{g\.backs\}-BACK SET`/.test(tpl) && /TE\/WR split assumed/.test(tpl) && /routes chart after the season/.test(tpl) && /Season in progress — charted sets/.test(tpl), 'the card label, subtitle, hint and footnote say what a charted set is');
const out=app.tpl(tpl, p);
chk(/"charting_only":true/.test(out) && /2026 · Charted sets · routes after the season/.test(out) && !/Routes mapped to players/.test(out), 'the rendered sheet ships the flag in its data script and says charted sets in its header');
chk(/rf\.name!='\\u2014' && rf\.list && rf\.list\.length\)\{/.test(tpl), 'pass mode prints the name and skips the route text when the list is empty (no crash on a charted set)');
const blocks=[...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
chk(blocks.length>=2 && blocks.every(b=>{ try{ new Function(b); return true; }catch(e){ console.log('    parse error:', e.message); return false; } }), 'every script block of the rendered sheet still parses');
const src=fs.readFileSync(path.join(__dirname,'..','src/js/73-coaching-scheme.js'),'utf8');
chk(/charted sets — personnel and routes publish after the season/.test(src) && /\$\{missingNote\}\$\{chartNote\}/.test(src), 'the modal subtitle carries the charted-sets note');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
