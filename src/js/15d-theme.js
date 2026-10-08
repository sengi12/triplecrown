// ═════════════════════════════════════════════════════════════════════════════
// Themes — a palette picked from the ☰ menu, kept in localStorage, applied as data-theme
// ═════════════════════════════════════════════════════════════════════════════
// Navy is the base palette (00-base.css) and the default; the others are token sets in
// 97-themes.css. The template replays the stored choice on <html> before the first paint
// (see the inline script in <head>), so this file only has to keep the attribute, the
// PWA bar colour and the menu row in step.
const TC_THEMES = [
  { id:'navy',     name:'Navy',     note:'the default', sw:['#0b1126','#4d93ff'], bar:'#0b1126' },
  { id:'midnight', name:'Midnight', note:'deeper dark',  sw:['#05070d','#5a9bff'], bar:'#05070d' },
  { id:'graphite', name:'Graphite', note:'neutral dark', sw:['#121316','#7aa2ff'], bar:'#121316' },
  { id:'light',    name:'Light',    note:'',             sw:['#ffffff','#2f6fe4'], bar:'#eef1f7' },
  { id:'sand',     name:'Sand',     note:'warm light',   sw:['#fffaf1','#b8542e'], bar:'#f3ede2' },
];
const TC_THEME_KEY = 'tc_theme';
function tcThemeById(id){ return TC_THEMES.find(t=>t.id===id) || TC_THEMES[0]; }
function tcTheme(){
  let id='navy';
  try{ id=localStorage.getItem(TC_THEME_KEY) || 'navy'; }catch(e){}
  return tcThemeById(id).id;
}
function tcApplyTheme(id){
  const t=tcThemeById(id);
  const root=document.documentElement;
  if(t.id==='navy') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t.id);
  const meta=document.querySelector('meta[name="theme-color"]'); if(meta) meta.setAttribute('content', t.bar);
  tcRenderThemeRow();
  return t.id;
}
function tcSetTheme(id){
  const t=tcThemeById(id);
  try{ if(t.id==='navy') localStorage.removeItem(TC_THEME_KEY); else localStorage.setItem(TC_THEME_KEY, t.id); }catch(e){}
  tcApplyTheme(t.id);
}
// The menu row: one swatch pill per theme, the current one filled.
function tcThemeRowHTML(){
  const cur=tcTheme();
  return TC_THEMES.map(t=>`<button type="button" class="tc-theme-opt${t.id===cur?' active':''}" role="radio" aria-checked="${t.id===cur?'true':'false'}" onclick="tcSetTheme('${t.id}')" title="${escAttr(t.note?`${t.name} — ${t.note}`:t.name)}"><span class="tc-theme-sw" style="--sw1:${t.sw[0]};--sw2:${t.sw[1]}"></span>${escHtml(t.name)}</button>`).join('');
}
function tcRenderThemeRow(){
  const row=document.getElementById('menuThemeRow'); if(!row) return;
  row.innerHTML=tcThemeRowHTML();
}
try{ tcApplyTheme(tcTheme()); }catch(e){}
