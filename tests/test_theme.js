// Themes: the ☰ menu offers a list, the choice lands on <html> as data-theme and in
// localStorage, Navy is the default and carries no attribute, the PWA bar colour follows,
// every theme has a token block in the stylesheet, and the template replays the stored
// choice before the first paint.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,setAttribute(k,v){this['_'+k]=v;},getAttribute(k){return this['_'+k];}};return elStore[id];}
const root={_attrs:{},setAttribute(k,v){this._attrs[k]=v;},removeAttribute(k){delete this._attrs[k];},getAttribute(k){return this._attrs[k]||null;},style:{}};
const meta={_c:'#0b1126',setAttribute(k,v){this._c=v;},getAttribute(){return this._c;}};
global.document={documentElement:root,getElementById:(id)=>mkEl(id),querySelector:(q)=>q==='meta[name="theme-color"]'?meta:null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){},classList:{add(){},remove(){}}}),activeElement:null,body:{appendChild(){},removeChild(){},classList:{add(){},remove(){}},style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200,scrollTo(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};
const fs=require('fs'), path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  return { THEMES:TC_THEMES, theme:tcTheme, set:tcSetTheme, apply:tcApplyTheme, row:tcThemeRowHTML, KEY:TC_THEME_KEY };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== the list, the default, the choice ===');
chk(app.THEMES.length>=5 && app.THEMES[0].id==='navy' && app.THEMES.some(t=>t.id==='light'), `five themes, Navy first (${app.THEMES.map(t=>t.id).join(', ')})`);
chk(app.theme()==='navy' && root.getAttribute('data-theme')===null, 'nothing stored → Navy, and no attribute on <html>');
app.set('light');
chk(app.theme()==='light' && root.getAttribute('data-theme')==='light' && localStorage.getItem(app.KEY)==='light', 'picking Light sets data-theme and stores it');
chk(meta.getAttribute()==='#eef1f7', 'the PWA bar colour follows the theme');
app.set('navy');
chk(root.getAttribute('data-theme')===null && localStorage.getItem(app.KEY)===null, 'back to Navy clears both');
app.set('nonsense');
chk(app.theme()==='navy', 'an unknown name falls back to Navy');
app.set('sand');
const row=app.row();
chk((row.match(/tc-theme-opt/g)||[]).length===app.THEMES.length && /tc-theme-opt active"[^>]*aria-checked="true"[^>]*onclick="tcSetTheme\('sand'\)"/.test(row), 'the menu row marks the current theme');
app.set('navy');

console.log('=== the stylesheet and the template carry every theme ===');
const css=fs.readFileSync(path.join(__dirname,'..','src/css/97-themes.css'),'utf8');
app.THEMES.filter(t=>t.id!=='navy').forEach(t=>chk(new RegExp(`:root\\[data-theme="${t.id}"\\]\\{[^}]*--bg:`).test(css), `${t.name} has a token block`));
chk(/data-theme="light"\]\{color-scheme:light/.test(css) && /data-theme="sand"\]\{color-scheme:light/.test(css), 'the light themes declare a light colour scheme');
chk(/--chip-on:#131a2e;--chip-on-ink:#ffffff/.test(css), 'a light ground gets a dark active chip with white ink');
chk(/:not\(\[data-theme="navy"\]\) \.gc-detail\{--gcn:var\(--surface\)/.test(css) && /\.la-trade\{--ltn:var\(--surface\)/.test(css), 'the Game Center and Trade Center follow the palette off Navy');
const base=fs.readFileSync(path.join(__dirname,'..','src/css/00-base.css'),'utf8');
chk(/--chip-on:#ffffff;--chip-on-ink:#0f1631;--on-accent:#0f1631;--zebra:/.test(base), 'the base palette defines the swapped tokens');
const tpl=fs.readFileSync(path.join(__dirname,'..','src/index.template.html'),'utf8');
chk(/localStorage\.getItem\('tc_theme'\)[^<]*setAttribute\('data-theme',t\)/.test(tpl) && tpl.indexOf("getItem('tc_theme')")<tpl.indexOf('<style>'), 'the template replays the stored theme before the stylesheet');
chk(/id="menuThemeRow"/.test(tpl), 'the menu has the theme row');
const order=fs.readdirSync(path.join(__dirname,'..','src/css')).filter(f=>f.endsWith('.css')).sort();
chk(order[order.length-1]==='97-themes.css' && order[order.length-2]==='96-theme-navy.css', 'the themes sheet loads last, after the navy theme');
console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
