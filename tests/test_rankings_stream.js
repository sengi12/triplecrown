// ═══════════════════════════════════════════════════════════════════════════
// Rankings mobile rendering: chunked row streaming + in-place control taps.
//
// The old phone path trimmed the board to 180 rows, showed a "Mobile quick-open"
// notice card, then re-rendered the WHOLE page on idle — so every control tap
// (the Filters drawer, the magnifier, a position chip) flashed the notice and
// parsed ~17k table cells twice. Now:
//   • the notice is gone entirely,
//   • full renders and cache hits stream rows into the live <tbody> over frames,
//   • Filters / search open-close are class flips on the mounted page,
//   • position-filter taps over an ALL board hide rows in place.
// ═══════════════════════════════════════════════════════════════════════════

const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){},focus(){},blur(){}};return elStore[id];}
const qsMap={};        // selector → stub element (tests install what they need)
const rafQueue=[];     // manual requestAnimationFrame drain
global.document={getElementById:id=>mkEl(id),
  querySelector:sel=>qsMap[sel]||null,
  querySelectorAll:sel=>(qsMap[sel]&&qsMap[sel].__list)||[],
  createElement:()=>({style:{},appendChild(){},click(){}}),body:{appendChild(){},removeChild(){}},
  addEventListener(){}, visibilityState:'visible',
  documentElement:{scrollTop:0,scrollHeight:5000}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},
  requestAnimationFrame:fn=>{rafQueue.push(fn);}, innerHeight:800, scrollY:0,
  scrollTo(x,y){global.window.scrollY=y;}, matchMedia:()=>({matches:false})};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){},length:0,key:()=>null};
global.Chart=function(){return{destroy(){},update(){}}};
global.confirm=()=>true; global.btoa=s=>s; global.FileReader=function(){}; global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.fetch=()=>Promise.reject(new Error('offline in test'));

const fs=require('fs');
const path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`return {
  splitCached:_rankingsSplitCachedRows,
  streamRows:_rankingsStreamRows,
  streamPending:()=>_rankingsStreamPending,
  bumpToken:()=>++_rankingsStreamToken,
  curToken:()=>_rankingsStreamToken,
  FIRST:RANKINGS_STREAM_FIRST, SLICE:RANKINGS_STREAM_SLICE,
  applyInPlace:applyRankingsFiltersInPlace,
  inPlaceActive:_rankingsInPlaceFiltersActive,
  posInPlace:rankingsPosFilterInPlace,
  toggleFilters:toggleRankFilters,
  filtersOpen:()=>rankFiltersOpen,
  setPhase:(v)=>{currentPhase=v;},
  setPosFilter_state:(v)=>{rankPosFilter=v;},
  setSearch:(v)=>{rankingsSearchQuery=v;},
  toggleSearch:toggleRankingsSearch,
  searchOpen:()=>rankingsSearchOpen,
  setSearchOpen:(v)=>{rankingsSearchOpen=v;},
};`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const drainRaf=()=>{let n=0;while(rafQueue.length&&n++<200){rafQueue.shift()();}};

console.log('=== the quick-open notice card is gone ===');
chk(!code.includes('Mobile quick-open: rendering top'), 'bundle no longer renders the "Mobile quick-open" notice card');
chk(!code.includes('_rankingsMobileAutoFullPass'), 'the two-phase auto-full-pass machinery is removed');

console.log('=== _rankingsSplitCachedRows: cached HTML splits losslessly into streamable rows ===');
const NROWS=300;
const rowArr=[]; for(let i=0;i<NROWS;i++) rowArr.push(`<tr class="r" data-i="${i}"><td>p${i}</td></tr>`);
const html=`<div>chrome</div><table><thead><tr><th>H</th></tr></thead><tbody>${rowArr.join('')}</tbody></table><div>after</div>`;
const sp=app.splitCached(html);
chk(!!sp, 'a 300-row board is split');
chk(sp && sp.rows.length===NROWS, `row count preserved (${sp?sp.rows.length:0} = ${NROWS})`);
chk(sp && (sp.pre+sp.rows.join('')+sp.post)===html, 'pre + rows + post reassembles the exact original HTML');
chk(sp && sp.pre.endsWith('<tbody>') && sp.post.startsWith('</tbody>'), 'split lands exactly on the tbody boundary (thead rows untouched)');
const smallHtml=`<table><tbody>${rowArr.slice(0,100).join('')}</tbody></table>`;
chk(app.splitCached(smallHtml)===null, 'a small board is not split (single parse is fine)');
chk(app.splitCached('<div>no table here</div>')===null, 'HTML without a tbody returns null');

console.log('=== _rankingsStreamRows: rows land in the tbody over frames; stale tokens abandon ===');
const tbody={isConnected:true, html:'', insertAdjacentHTML(where,s){this.html+=s;}, querySelectorAll:()=>[]};
qsMap['#content .rankings-table tbody']=tbody;
app.setPosFilter_state('ALL'); app.setSearch('');
let doneCalled=false;
let tok=app.bumpToken();
app.streamRows(tok, rowArr.slice(0,10).map(r=>r), ()=>{doneCalled=true;});
chk(app.streamPending()===true, 'stream marked pending before the first frame');
drainRaf();
chk(tbody.html.split('<tr').length-1===10, 'all 10 remaining rows appended into the tbody');
chk(doneCalled, 'onDone fired after the last chunk');
chk(app.streamPending()===false, 'pending cleared when the stream finishes');
tbody.html='';
tok=app.bumpToken();
app.streamRows(tok, rowArr.slice(0,10), ()=>{});
app.bumpToken();   // a newer render supersedes the stream before its first frame
drainRaf();
chk(tbody.html==='', 'a superseded token appends nothing (stale stream abandoned)');
tbody.html='';
tok=app.bumpToken();
tbody.isConnected=false;   // phase switch replaced #content
app.streamRows(tok, rowArr.slice(0,10), ()=>{});
drainRaf();
chk(tbody.html==='', 'a disconnected tbody stops the stream');
tbody.isConnected=true;

console.log('=== position filter applies in place over an ALL-rendered standard board ===');
const mkRow=(pos,rk)=>({_display:'',style:{},
  classList:{contains:()=>false},
  getAttribute(a){ if(a==='data-rank-pos')return pos; if(a==='data-rank-rk')return rk?'1':null;
    if(a==='data-rank-search')return pos.toLowerCase()+' name'; return null; },
  get display(){return this.style.display;}});
const domRows=[mkRow('QB'),mkRow('RB'),mkRow('RB',true),mkRow('WR'),mkRow('TE')];
const tableEl={getAttribute:(a)=>a==='data-rank-rendered-pos'?'ALL':(a==='data-rank-adv'?'0':null)};
const tbody2={isConnected:true, querySelectorAll:()=>domRows, insertAdjacentHTML(){}};
qsMap['.rankings-table']=tableEl;
qsMap['.rankings-table tbody']=tbody2;
qsMap['#content .rankings-table']=tableEl;
const btnList=['ALL','QB','RB','WR','TE','FLEX','ROOKIES'].map(t=>({textContent:t,_active:null,classList:{toggle(c,v){if(c==='active')this._v=v;}},get active(){return this.classList._v;}}));
qsMap['#content .rank-toolbar .pos-filter-btn']={__list:btnList};
const countEl=mkEl('rankPlayerCount');
countEl.getAttribute=(a)=>a==='data-default-label'?'5 players':'';
app.setPosFilter_state('RB');
chk(app.posInPlace()===true, 'RB tap over an ALL board is handled in place');
chk(domRows.filter(r=>r.style.display==='').length===2 && domRows[1].style.display==='' && domRows[2].style.display==='', 'only the two RB rows stay visible');
chk(mkEl('rankPlayerCount').textContent==='2 players', 'count label updates to the filtered count');
app.setPosFilter_state('FLEX'); app.applyInPlace();
chk(domRows[0].style.display==='none' && domRows.slice(1).every(r=>r.style.display===''), 'FLEX hides only the QB row');
app.setPosFilter_state('ROOKIES'); app.applyInPlace();
chk(domRows.filter(r=>r.style.display==='').length===1 && domRows[2].style.display==='', 'ROOKIES keeps only the data-rank-rk row');
app.setPosFilter_state('ALL'); app.applyInPlace();
chk(domRows.every(r=>r.style.display===''), 'back to ALL restores every row');
chk(mkEl('rankPlayerCount').textContent==='5 players', 'count label falls back to the rendered default');
app.setPosFilter_state('WR');
chk(app.inPlaceActive()===true, 'streamer sees the in-place pos filter as active');
app.setPosFilter_state('ALL');
chk(app.inPlaceActive()===false, 'no filters → nothing for late rows to obey');
const advTable={getAttribute:(a)=>a==='data-rank-rendered-pos'?'ALL':(a==='data-rank-adv'?'1':null)};
qsMap['#content .rankings-table']=advTable; qsMap['.rankings-table']=advTable;
app.setPosFilter_state('RB');
chk(app.posInPlace()===false, 'Adv. Metrics board falls back to a full render (columns change per position)');
qsMap['#content .rankings-table']=tableEl; qsMap['.rankings-table']=tableEl;
app.setPosFilter_state('ALL');

console.log('=== Filters drawer + search toggle are class flips, not re-renders ===');
const filtersRow={_open:null,classList:{toggle(c,v){if(c==='open')filtersRow._open=v;}}};
const filtersBtn={_active:null,classList:{toggle(c,v){if(c==='active')filtersBtn._active=v;}}};
qsMap['#content .rank-toolbar .rank-filters']=filtersRow;
qsMap['#content .rank-filters-toggle']=filtersBtn;
app.setPhase('Rankings');
const before=mkEl('content').innerHTML;
app.toggleFilters();
chk(app.filtersOpen()===true && filtersRow._open===true && filtersBtn._active===true, 'opening the drawer flips classes in place');
app.toggleFilters();
chk(app.filtersOpen()===false && filtersRow._open===false, 'closing flips them back');
chk(mkEl('content').innerHTML===before, '#content was never re-rendered by the drawer');
const searchWrap={_hidden:null,classList:{add(c){if(c==='rank-search-hidden')searchWrap._hidden=true;},remove(c){if(c==='rank-search-hidden')searchWrap._hidden=false;},toggle(){}}};
const searchInput=mkEl('rankSearchInput'); searchInput.value='';
const searchBtn={classList:{add(){searchBtn._on=true;},remove(){searchBtn._on=false;},toggle(){}}};
qsMap['#content .rank-search-wrap']=searchWrap;
qsMap['#content .rank-search-toggle']=searchBtn;
qsMap['#content .rank-search-clear']={classList:{add(){},remove(){},toggle(){}}};
app.setSearchOpen(false); app.setSearch('');
app.toggleSearch();
chk(app.searchOpen()===true && searchWrap._hidden===false, 'opening search unhides the mounted wrap');
app.setSearch('mahomes');
app.toggleSearch();
chk(app.searchOpen()===false && searchWrap._hidden===true, 'closing search hides the wrap');
chk(mkEl('content').innerHTML===before, '#content untouched by the search toggle');

console.log(`\n${pass}/${total} checks passed`);
process.exit(pass===total?0:1);
