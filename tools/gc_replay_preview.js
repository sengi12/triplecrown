// An interactive preview of the Game Center's click-to-replay: the real play feed on the
// left, the drive field on the right. Tapping a play pins the field to it and animates it;
// the red LIVE button hands the field back. Runs the built app code in a sandbox and wires
// its own repaint, so no live game is needed. Not shipped.
//   node tools/gc_replay_preview.js [out.html]   → default /tmp/gc_replay_preview.html
const fs=require('fs'), path=require('path');
const root=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(root,'tests','check.js'),'utf8');
const sum=fs.readFileSync(path.join(root,'tests','fixtures','espn_summary_2026_w1_tb_cin.json'),'utf8');
// safe-embed: a JS string literal whose "</" can never close the host <script>
const embed=(s)=>JSON.stringify(s).replace(/<\//g,'<\\/');

const wiring=[
  "pcardOnclick=function(pid,pos,team){ return \"event.stopPropagation();window.__nameTap&&window.__nameTap('\"+pos+\"','\"+team+\"')\"; };",
  "sleeperPlayers={};",
  "_gcd.feedAll=true;",
  "var SUM=JSON.parse(__SUMTEXT);",
  "var GAME={ id:'TB@CIN', away:'TB', home:'CIN', eid:'401872925', state:'post', detail:'Final', hs:33, as:27, arec:'0-1', hrec:'1-0' };",
  "renderRightSidebar=function(){ var f=document.getElementById('gcp-feed'); if(f) f.innerHTML=gcFeedHTML(GAME,SUM); var d=document.getElementById('gcp-field'); if(d) d.innerHTML=gcDriveChartHTML(GAME,SUM); };",
  "['gcReplayPlay','gcReplayClear','gcdSetFeedAll','gcdSetTab','gcWinProbToggle'].forEach(function(k){ try{ window[k]=eval(k); }catch(e){} });",
  "renderRightSidebar();"
].join("\n");
// the built app auto-inits at load and writes into elements this bare page does not have;
// hand any unknown id a throwaway div (the test harness does the same), keeping our two real
// containers real
const shim="(function(){var real=document.getElementById.bind(document);document.getElementById=function(id){var el=real(id);return el||document.createElement('div');};})();\n";

const page=`<!doctype html><meta charset="utf-8"><title>Game Center — click-to-replay</title>
<style>
  :root{--text:#e6edf3;--muted:#8b949e;--border:#21262d;--surface:#0d1117;--surface2:#161b22;--accent:#3d9bff;--danger:#e5484d;}
  body{background:#0d1117;color:var(--text);font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:22px;}
  h1{font-size:19px;margin:0 0 2px;} .sub{color:#8b949e;margin:0 0 18px;font-size:13px;max-width:820px;}
  .wrap{display:grid;grid-template-columns:360px minmax(0,1fr);gap:22px;align-items:start;max-width:900px;}
  .col h2{font-size:13px;color:#f5c542;margin:0 0 8px;text-transform:uppercase;letter-spacing:.4px;}
  #gcp-field{position:sticky;top:22px;}
  .gcf{display:flex;flex-direction:column;gap:7px;} .gcf-bar{display:flex;align-items:center;gap:8px;margin-bottom:8px;color:#8b949e;font-size:12px;}
  .gcf-bar button{background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:999px;padding:3px 10px;font-weight:700;cursor:pointer;}
  .gcf-bar button.active{background:var(--accent);border-color:var(--accent);color:#fff;}
  .gcf-row{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:start;padding:8px 8px 8px 6px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);}
  .gcf-logo{width:22px;height:22px;} .gcf-sit{font-size:11px;color:#8b949e;} .gcf-title{font-weight:800;font-size:13px;margin:1px 0;}
  .gcf-who{display:flex;flex-wrap:wrap;gap:5px;align-items:center;font-size:11px;color:#adbac7;margin-top:2px;cursor:pointer;}
  .gcf-name{font-weight:800;color:var(--text);} .gcf-pos{color:#8b949e;} .gcf-owner{color:#6e9;} .gcf-stat{color:#8b949e;}
  .gcf-right{text-align:right;font-size:11px;color:#8b949e;} .gcf-clock{font-weight:700;} .gcf-score{margin-top:2px;} .gcf-dash{opacity:.5;margin:0 2px;}
  .gcf-badge{display:inline-block;margin-top:3px;padding:1px 5px;border-radius:5px;background:#30363d;font-weight:800;font-size:10px;}
  .gcf-sc-hit{color:#fff;font-weight:800;} .gcf-rz{color:#e5484d;font-weight:800;}
  .gcf-click{cursor:pointer;transition:border-color .12s,background .12s;} .gcf-click:hover{border-color:var(--accent);}
  .gcf-row.gcf-active{border-color:var(--accent);background:rgba(61,155,255,.12);}
  .gc-drive{margin:0;} .gc-drive-svg{width:100%;height:auto;display:block;background:#0d1117;border-radius:10px;}
  .gc-drive-sum{font-size:11px;color:#adbac7;font-weight:700;padding:6px 2px;text-align:center;}
  .gc-drive-replay{outline:1.5px solid rgba(61,155,255,.55);outline-offset:-1px;border-radius:12px;padding:6px;}
  .gc-drive-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px 6px;}
  .gc-replay-tag{font-size:11px;font-weight:800;color:var(--accent);letter-spacing:.3px;}
  .gc-live-btn{display:inline-flex;align-items:center;gap:4px;background:var(--danger);color:#fff;border:none;border-radius:999px;font:800 11px/1 inherit;letter-spacing:.5px;padding:5px 11px;cursor:pointer;}
  .gc-live-btn:hover{filter:brightness(1.08);} .gc-live-btn:active{transform:scale(.96);}
  .gc-seg-kick{stroke:#9aa5b1!important;stroke-dasharray:3 3;opacity:.7;} .gc-seg-fg{stroke-dasharray:4 3;}
  .gc-seg-inc{stroke:#9aa5b1!important;stroke-dasharray:5 4;opacity:.75;} .gc-seg-pen{stroke:#f5c542!important;stroke-dasharray:4 4;opacity:.85;} .gc-seg-tb{opacity:.7;}
  .gc-seg-ret{stroke-dasharray:none;} .gc-glogo{width:14px;height:14px;vertical-align:-2px;}
  .gc-last-wrap,.gc-wp{display:none;}
</style>
<h1>Game Center — tap a play to replay it</h1>
<p class="sub">The real feed and the real field, driven by the built app (TB @ CIN, a finished game). Tap any play row → the field pins to it and the segment animates. Tap the <b style="color:#e5484d">● LATEST</b> button (it reads <b style="color:#e5484d">● LIVE</b> during a live game) to hand the field back. Tapping a player's name opens their card instead — the name tap stops the row tap.</p>
<div class="wrap">
  <div class="col"><h2>Play feed</h2><div id="gcp-feed"></div></div>
  <div class="col"><h2>The field</h2><div id="gcp-field"></div></div>
</div>
<script>
var __CODE=${embed(code)};
var __SUM=${embed(sum)};
var __WIRING=${embed(wiring)};
var __SHIM=${embed(shim)};
(function(){
  window.__nameTap=function(pos,team){ alert('Player card → '+pos+' · '+team+'   (name taps open the card, not the replay)'); };
  try{ new Function('__SUMTEXT', __SHIM+__CODE+"\\n"+__WIRING)(__SUM); }
  catch(e){ document.getElementById('gcp-field').innerHTML='<pre style="color:#e5484d;white-space:pre-wrap">'+String(e&&e.stack||e)+'</pre>'; }
})();
</script>`;
const out=process.argv[2]||'/tmp/gc_replay_preview.html';
fs.writeFileSync(out, page);
console.log('wrote', out);
