const fs=require('fs');
const path=require('path');

const elStore={};
function mkEl(id){
  if(!elStore[id]){
    elStore[id]={
      id,
      innerHTML:'',
      textContent:'',
      style:{},
      classList:{add(){},remove(){}},
      querySelector:()=>null,
      querySelectorAll:()=>[],
      appendChild(){},
      addEventListener(){},
      remove(){delete elStore[id];},
      getBoundingClientRect:()=>({left:0,top:0,bottom:0,width:0,height:0})
    };
  }
  return elStore[id];
}

global.document={
  getElementById:(id)=>elStore[id]||mkEl(id),
  querySelector:()=>null,
  querySelectorAll:()=>[],
  createElement:(t)=>({
    tagName:t,
    style:{},
    className:'',
    id:'',
    innerHTML:'',
    appendChild(){},
    addEventListener(){},
    remove(){},
    querySelector:()=>null,
    querySelectorAll:()=>[],
    getBoundingClientRect:()=>({left:0,top:0,bottom:0,width:0,height:0})
  }),
  body:{appendChild:(e)=>{if(e&&e.id) elStore[e.id]=e;},removeChild(){}},
  addEventListener(){}
};

global.window={innerWidth:1200,innerHeight:800};
global.Chart=function(){return{destroy(){}}};
global.confirm=()=>1;
global.btoa=s=>s;
global.FileReader=function(){};
global.Range=function(){};
global.AbortController=class{constructor(){this.signal={};}abort(){}};
global.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve({}),text:()=>Promise.resolve('')});
global.toast=()=>{};

global.NFL_LOGO=(tm)=>`logo_${tm||''}`;

const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return { escHtml, escJsSingle, pcardOnclick, laAssetRow };`)();

let pass=0,total=0;
const chk=(cond,label)=>{
  total++;
  if(cond){ pass++; console.log('  PASS:',label); }
  else console.log('  FAIL:',label);
};

console.log('=== input injection guards ===');

const htmlPayload=`<img src=x onerror="alert('xss')">`;
const htmlEsc=app.escHtml(htmlPayload);
chk(!htmlEsc.includes('<img'), 'escHtml strips raw tags');
chk(htmlEsc.includes('&lt;img'), 'escHtml encodes tag openers');
chk(htmlEsc.includes('&#39;xss&#39;'), 'escHtml encodes single quotes');

const jsPayload="x\\y'\n\r\u2028\u2029";
const jsEsc=app.escJsSingle(jsPayload);
chk(!jsEsc.includes("\n"), 'escJsSingle escapes newlines');
chk(jsEsc.includes("\\\\y"), 'escJsSingle escapes backslashes');
chk(jsEsc.includes("\\'"), 'escJsSingle escapes apostrophes');

const click=app.pcardOnclick("bad');alert(1)//",'WR','CIN');
chk(click.startsWith("openPlayerCard('"), 'pcardOnclick keeps expected call shape');
chk(!click.includes("openPlayerCard('bad');"), 'pcardOnclick blocks quote-breakout sequence');
chk(click.includes("bad\\');alert(1)//"), 'pcardOnclick escapes single-quote payload');

const row=app.laAssetRow({
  type:'p',
  key:"id');alert(1)//",
  id:"id');alert(1)//",
  name:"<svg onload=alert(1)>",
  pos:'WR',
  team:'CIN',
  v:77,
  age:23,
  posRank:12
}, 'a', false);

chk(!row.includes('<svg onload=alert(1)>'), 'laAssetRow escapes dangerous player name HTML');
chk(row.includes('&lt;svg onload=alert(1)&gt;'), 'laAssetRow renders escaped name text');
chk(!row.includes("laTradeToggle('a','id');alert(1)//')"), 'laAssetRow blocks trade key quote-breakout');
chk(row.includes("laTradeToggle('a','id\\');alert(1)//')"), 'laAssetRow escapes key for inline JS context');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
