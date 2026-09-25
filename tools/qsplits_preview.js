// Quick visual preview of the per-quarter volume splits (carry share for RBs, target share
// for receivers), using the real player-card CSS. Not shipped.
//   node tools/qsplits_preview.js [out.html]
const fs=require('fs'), path=require('path');
const root=path.join(__dirname,'..');
const el=()=>({style:{},innerHTML:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return'';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}});
global.document={getElementById:()=>el(),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>el(),body:el(),activeElement:null};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>1; global.btoa=s=>s; global.FileReader=function(){}; global.Range=function(){};
global.AbortController=class{constructor(){this.signal={};}abort(){}};
const code=fs.readFileSync(path.join(root,'tests','check.js'),'utf8');
const app=new Function(code+'return {q:_qtrShareSplits};')();

const rb={games:[{wk:1,qc:[6,2,4,0],qt:[8,4,8,0]},{wk:2,qc:[3,3,1,2],qt:[6,6,4,4]}]};
const wr={games:[{wk:1,qc:[3,5,4,2],qt:[9,11,10,8]},{wk:2,qc:[2,4,6,3],qt:[8,9,12,9]}]};
const carry=app.q(rb,null,'Carry share by quarter','\u00b7 his cut of the team\u2019s designed runs','designed rushes','CAR');
const tgt=app.q(wr,null,'Target share by quarter','\u00b7 his cut of the team\u2019s throws','targeted throws','TAR');
const css=fs.readFileSync(path.join(root,'src','css','10-player-card.css'),'utf8');

const html=`<!doctype html><meta charset="utf-8"><title>Quarter volume splits</title>
<style>:root{--text:#e6edf3;--muted:#8b949e;--border:#21262d;--surface2:#161b22;--surface:#0d1117;--success:#2fae4e;--danger:#e5484d;--accent:#3d9bff;}
body{background:#0d1117;color:#e6edf3;font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px;max-width:460px;}
h3{color:#f5c542;font-size:13px;text-transform:uppercase;letter-spacing:.4px;margin:26px 0 0;}
.note{color:#8b949e;font-size:12px;margin:2px 0 0;}
${css}</style>
<h3>RB \u2014 under the rushing map, after Broken tkl</h3>
<p class="note">6/8, 2/4, 4/8, 0/0 (wk1) + 3/6, 3/6, 1/4, 2/4 (wk2) \u2192 64% / 50% / 42% / 50%</p>
${carry}
<h3>WR/TE \u2014 under the target map</h3>
<p class="note">his targets over the team\u2019s throws, by quarter</p>
${tgt}`;
const out=process.argv[2]||'/tmp/qsplits.html';
fs.writeFileSync(out, html);
console.log('wrote', out);
