// throwaway: render the NGS footer marks onto the real card CSS for a visual check
const fs=require('fs');
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},classList:{add(){},remove(){}}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.fetch=()=>Promise.reject(new Error('offline'));
const code=fs.readFileSync('tests/check.js','utf8');
const app=new Function(code+'return {link:ngsChartLink};')();
const node={pos:'WR',team:'LAR',esb:'ADA218591'};
const markup=app.link(node,'Davante Adams',2026,null);
const css=fs.readFileSync('src/css/37-target-map.css','utf8');
const html=`<!doctype html><meta charset=utf8><style>
body{margin:0;background:#0d0f11;color:#e8eaed;font:13px -apple-system,Arial,sans-serif;padding:40px;}
:root{--muted:#9aa0a6;--accent:#4c9be8;--border:#2a2d31;}
.card{max-width:460px;margin:0 auto 24px;background:#16181b;border:1px solid #2a2d31;border-radius:12px;padding:18px;}
.pcard-src{font-size:9.5px;color:var(--muted);text-align:center;padding:10px 0 2px;}
${css}
.light{background:#f4f5f7;padding:24px;border-radius:12px;} .light .card{background:#fff;border-color:#dcdfe3;color:#111;margin-bottom:0;} .light .pcard-src{color:#6b7075;}
.big{transform:scale(2.4);transform-origin:left center;display:inline-block;margin:30px 0 30px 40px;}
</style>
<div class="big">${markup}</div>
<div class=card><div style="height:120px;border:1px dashed #2a2d31;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#5a5f66">DAVANTE ADAMS · route tree</div>
<div class="pcard-src">All data provided by nflverse.${markup}</div></div>
<div class="light"><div class=card><div style="height:70px;border:1px dashed #dcdfe3;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#aeb3b8">rushing lanes</div><div class="pcard-src">All data provided by nflverse.${markup}</div></div></div>`;
fs.writeFileSync('tools/_ngs_logo_preview.html',html);
console.log('wrote tools/_ngs_logo_preview.html');
