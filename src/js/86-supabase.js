// ─────────────────────────────────────────────────────────────────────────────
// Supabase Auth + Cloud Projections Manager
// ─────────────────────────────────────────────────────────────────────────────
//
// SETUP (one-time, ~5 minutes):
//
// 1. Go to https://supabase.com → New project (free tier, no credit card)
// 2. Settings → API → copy "Project URL" and "anon public" key into the two
//    constants below.
// 3. For Google sign-in: Authentication → Providers → Google → enable it,
//    paste your Google OAuth client ID + secret (from console.cloud.google.com).
// 4. Run this SQL once in the Supabase SQL Editor:
//
//   create table if not exists tc_projections (
//     id          uuid        primary key default gen_random_uuid(),
//     user_id     uuid        references auth.users not null,
//     name        text        not null default 'My Projections',
//     season      text,
//     sort_order  int         default 0,
//     data        jsonb       not null,
//     created_at  timestamptz default now(),
//     updated_at  timestamptz default now()
//   );
//   alter table tc_projections enable row level security;
//   create policy "users own their projections"
//     on tc_projections for all
//     using  (auth.uid() = user_id)
//     with check (auth.uid() = user_id);
//
// ─────────────────────────────────────────────────────────────────────────────

const TC_SUPABASE_URL      = 'https://agnbcpczmrsoszdjxrqr.supabase.co';  // 'https://xxxxxxxxxx.supabase.co'
const TC_SUPABASE_ANON_KEY = 'sb_publishable_sF7QFEaRJx_USKUqmIZQcQ_y1QAnUKi';  // 'eyJ...'

// ── Internal state ────────────────────────────────────────────────────────────
let _tcClient = null;
let _tcUser   = null;
let _tcMgrProjs = [];   // cached projection list for manager

// ── Initialise Supabase client ────────────────────────────────────────────────
(function _tcInit(){
  if(typeof window === 'undefined') return;
  if(!TC_SUPABASE_URL || !TC_SUPABASE_ANON_KEY) return;  // not yet configured
  const sb = window.supabase;
  if(!sb || typeof sb.createClient !== 'function'){
    console.warn('[TC] Supabase SDK not loaded — cloud features disabled');
    return;
  }
  try{
    _tcClient = sb.createClient(TC_SUPABASE_URL, TC_SUPABASE_ANON_KEY);
    // Restore existing session from localStorage (automatic on every page load)
    _tcClient.auth.getSession().then(({data:{session}})=>{
      _tcUser = session ? session.user : null;
      syncAuthChrome();
    }).catch(e=>console.warn('[TC] getSession error:', e));
    // Keep state in sync whenever auth changes (sign-in, sign-out, token refresh)
    _tcClient.auth.onAuthStateChange((_event, session)=>{
      _tcUser = session ? session.user : null;
      syncAuthChrome();
    });
  }catch(e){ console.warn('[TC] Supabase init error:', e); }
})();

// Sync chrome once immediately so Save/Manager buttons appear as soon as the
// script runs (before the async getSession() resolves). This runs AFTER syncAppChrome
// in 85-import-export.js since 86 comes after 85 in build order.
syncAuthChrome();

// ── Chrome sync — called by syncAppChrome (85) AND by auth state changes ──────
function syncAuthChrome(){
  // syncAppChrome() in 85-import-export.js may call this during init, BEFORE this file's
  // top-level `const` declarations execute. `const` is in the temporal dead zone until then,
  // so reading TC_SUPABASE_URL would throw a ReferenceError. Guard with try/catch and bail
  // out early — 86's own trailing syncAuthChrome() call re-runs this once the consts exist.
  let configured = false;
  try{
    configured = !!(TC_SUPABASE_URL && TC_SUPABASE_ANON_KEY);
  }catch(e){ return; }

  const signedIn = !!_tcUser;

  // Auth button: use innerHTML so the TC_ICON SVG renders alongside the label
  const authBtn = document.getElementById('menuAuthBtn');
  if(authBtn){
    const iconHtml = (typeof TC_ICON==='function') ? TC_ICON('user') : '';
    const labelTxt = signedIn
      ? (_tcUser.email||'').split('@')[0]
      : 'Sign In';
    authBtn.innerHTML = `${iconHtml} ${escHtml(labelTxt)}`;
    authBtn.title = signedIn ? (_tcUser.email||'') : 'Sign in to save projections';
  }

  // Save + Manager only visible when Supabase is configured
  ['menuSaveBtn','menuManagerBtn'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = configured ? '' : 'none';
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth Modal
// ─────────────────────────────────────────────────────────────────────────────
function tcOpenAuthModal(reason){
  if(document.getElementById('tcAuthOverlay')) return;
  const ov = document.createElement('div');
  ov.id = 'tcAuthOverlay';
  ov.className = 'tc-modal-overlay';
  ov.innerHTML = `
    <div class="tc-modal" role="dialog" aria-label="Sign in to TripleCrown">
      <div class="tc-modal-head">
        <span class="tc-modal-title">Sign In to TripleCrown</span>
        <button class="tc-modal-close" onclick="tcCloseAuthModal()" aria-label="Close">✕</button>
      </div>
      ${reason ? `<div class="tc-auth-reason">${escHtml(reason)}</div>` : ''}
      <div class="tc-auth-tabs" id="tcAuthTabs">
        <button class="tc-auth-tab active" id="tcTabSignIn"  onclick="tcSwitchAuthTab('signin')">Sign In</button>
        <button class="tc-auth-tab"        id="tcTabSignUp"  onclick="tcSwitchAuthTab('signup')">Create Account</button>
      </div>
      <div class="tc-auth-form">
        <input class="tc-input" id="tcAuthEmail" type="email"    placeholder="Email"    autocomplete="email"            >
        <input class="tc-input" id="tcAuthPass"  type="password" placeholder="Password" autocomplete="current-password" >
        <div class="tc-form-err" id="tcAuthErr" hidden></div>
        <button class="tc-btn tc-btn-primary" id="tcAuthSubmit" onclick="tcAuthSubmit()">Sign In</button>
        <div class="tc-auth-divider"><span>or</span></div>
        <button class="tc-btn tc-btn-google" onclick="tcSignInGoogle()">
          <svg width="16" height="16" viewBox="0 0 18 18" style="flex-shrink:0">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 12.015 17.64 9.707 17.64 6.967c0-.637-.057-1.251-.164-1.84z" transform="translate(0 .2)"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A9.009 9.009 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          Continue with Google
        </button>
      </div>
      ${_tcUser ? `<div class="tc-auth-signout">
        <button class="tc-btn tc-btn-ghost tc-btn-sm" onclick="tcSignOut()">
          Sign out of ${escHtml((_tcUser.email||'').split('@')[0])}
        </button></div>` : ''}
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('mousedown', e=>{ if(e.target===ov) tcCloseAuthModal(); });
  // Enter key submits
  ov.addEventListener('keydown', e=>{ if(e.key==='Enter') tcAuthSubmit(); });
  setTimeout(()=>{ document.getElementById('tcAuthEmail')?.focus(); }, 60);
}

function tcCloseAuthModal(){
  document.getElementById('tcAuthOverlay')?.remove();
}

function tcSwitchAuthTab(tab){
  const signIn = tab === 'signin';
  document.getElementById('tcTabSignIn')?.classList.toggle('active',  signIn);
  document.getElementById('tcTabSignUp')?.classList.toggle('active', !signIn);
  const submit = document.getElementById('tcAuthSubmit');
  if(submit) submit.textContent = signIn ? 'Sign In' : 'Create Account';
  const pass = document.getElementById('tcAuthPass');
  if(pass) pass.autocomplete = signIn ? 'current-password' : 'new-password';
  const err = document.getElementById('tcAuthErr');
  if(err){ err.textContent = ''; err.hidden = true; }
}

function tcAuthSubmit(){
  if(!_tcClient){ toast('Supabase not configured','err'); return; }
  const email   = (document.getElementById('tcAuthEmail')?.value||'').trim();
  const pass    = (document.getElementById('tcAuthPass')?.value ||'');
  const isSignUp = document.getElementById('tcTabSignUp')?.classList.contains('active');
  if(!email || !pass){ _tcShowFormErr('tcAuthErr','Email and password are required'); return; }
  const btn = document.getElementById('tcAuthSubmit');
  if(btn){ btn.disabled = true; btn.textContent = isSignUp ? 'Creating account…' : 'Signing in…'; }
  const promise = isSignUp
    ? _tcClient.auth.signUp({ email, password: pass })
    : _tcClient.auth.signInWithPassword({ email, password: pass });
  promise.then(({data, error})=>{
    if(btn){ btn.disabled = false; btn.textContent = isSignUp ? 'Create Account' : 'Sign In'; }
    if(error){ _tcShowFormErr('tcAuthErr', error.message); return; }
    if(isSignUp && data.user && !data.session){
      _tcShowFormErr('tcAuthErr', 'Check your email to confirm your account, then sign in.', 'info');
      return;
    }
    tcCloseAuthModal();
    toast(`Signed in as ${data.user?.email||email} ✓`, 'ok');
  }).catch(e=>{
    if(btn){ btn.disabled = false; btn.textContent = isSignUp ? 'Create Account' : 'Sign In'; }
    _tcShowFormErr('tcAuthErr', e.message || 'An unknown error occurred');
  });
}

function tcSignInGoogle(){
  if(!_tcClient){ toast('Supabase not configured','err'); return; }
  _tcClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href.split('#')[0] },
  }).catch(e=>toast('Google sign-in failed: '+e.message,'err'));
}

function tcSignOut(){
  if(!_tcClient) return;
  _tcClient.auth.signOut().then(()=>{
    _tcUser = null;
    syncAuthChrome();
    tcCloseAuthModal();
    tcCloseManager();
    toast('Signed out','ok');
  }).catch(e=>toast('Sign-out failed: '+e.message,'err'));
}

function _tcShowFormErr(id, msg, type){
  const el = document.getElementById(id);
  if(!el) return;
  el.textContent = msg;
  el.className = 'tc-form-err' + (type==='info' ? ' tc-form-info' : '');
  el.hidden = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Save
// ─────────────────────────────────────────────────────────────────────────────
function tcSaveClick(){
  closeAppMenu();
  if(!TC_SUPABASE_URL){ toast('Supabase not configured — see src/js/86-supabase.js','err'); return; }
  if(!_tcUser){ tcOpenAuthModal('Sign in to save your projections to the cloud'); return; }
  const defaultName = (document.getElementById('scenarioName')?.value||'').trim()
    || `${typeof PROJ_SEASON!=='undefined' ? PROJ_SEASON : new Date().getFullYear()} Projections`;
  _tcOpenSavePrompt(defaultName);
}

function _tcOpenSavePrompt(defaultName){
  if(document.getElementById('tcSaveOverlay')) return;
  const ov = document.createElement('div');
  ov.id = 'tcSaveOverlay';
  ov.className = 'tc-modal-overlay';
  ov.innerHTML = `
    <div class="tc-modal tc-modal-sm" role="dialog" aria-label="Save projections">
      <div class="tc-modal-head">
        <span class="tc-modal-title">Save Projections</span>
        <button class="tc-modal-close" onclick="document.getElementById('tcSaveOverlay').remove()" aria-label="Close">✕</button>
      </div>
      <div class="tc-save-body">
        <label class="tc-label" for="tcSaveName">Save name</label>
        <input class="tc-input" id="tcSaveName" type="text" value="${escAttr(defaultName)}"
               maxlength="80" placeholder="e.g. 2026 Dynasty Build">
        <div class="tc-form-err" id="tcSaveErr" hidden></div>
        <button class="tc-btn tc-btn-primary" id="tcSaveBtnOk" onclick="tcDoSave()">Save</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('mousedown', e=>{ if(e.target===ov) ov.remove(); });
  ov.addEventListener('keydown', e=>{ if(e.key==='Enter') tcDoSave(); });
  setTimeout(()=>{ const n=document.getElementById('tcSaveName'); if(n){n.focus();n.select();} }, 60);
}

async function tcDoSave(){
  const nameEl = document.getElementById('tcSaveName');
  const name   = (nameEl?.value||'').trim();
  if(!name){ _tcShowFormErr('tcSaveErr','Please enter a save name'); return; }
  const btn = document.getElementById('tcSaveBtnOk');
  if(btn){ btn.disabled = true; btn.textContent = 'Saving…'; }
  try{
    const payload = buildOutput();
    if(!payload.projections.length) throw new Error('No projection data to save (adjust some sliders first)');
    const season = String(payload.projections[0]?.season || '');
    const {error} = await _tcClient
      .from('tc_projections')
      .insert({ user_id: _tcUser.id, name, season, data: payload, sort_order: Date.now() });
    if(error) throw error;
    document.getElementById('tcSaveOverlay')?.remove();
    _tcMgrProjs = [];   // invalidate cache so Manager refreshes
    toast(`"${name}" saved to cloud ✓`, 'ok');
  }catch(e){
    if(btn){ btn.disabled = false; btn.textContent = 'Save'; }
    _tcShowFormErr('tcSaveErr', e.message || 'Save failed');
    toast('Save failed: '+(e.message||'unknown error'), 'err');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Manager Modal
// ─────────────────────────────────────────────────────────────────────────────
async function tcOpenManager(){
  closeAppMenu();
  if(!TC_SUPABASE_URL){ toast('Supabase not configured — see src/js/86-supabase.js','err'); return; }
  if(!_tcUser){ tcOpenAuthModal('Sign in to access your saved projections'); return; }
  if(document.getElementById('tcManagerOverlay')) return;

  const ov = document.createElement('div');
  ov.id = 'tcManagerOverlay';
  ov.className = 'tc-modal-overlay';
  ov.innerHTML = `
    <div class="tc-modal tc-modal-mgr" role="dialog" aria-label="Projections Manager">
      <div class="tc-modal-head">
        <span class="tc-modal-title">My Projections</span>
        <button class="tc-modal-close" onclick="tcCloseManager()" aria-label="Close">✕</button>
      </div>
      <div class="tc-mgr-user">
        <span>👤 ${escHtml(_tcUser.email||'')}</span>
        <button class="tc-btn tc-btn-ghost tc-btn-xs" onclick="tcSignOut()">Sign out</button>
      </div>
      <button class="tc-btn tc-btn-primary tc-mgr-new-btn"
              onclick="document.getElementById('tcManagerOverlay').remove();tcSaveClick()">
        + Save current projections
      </button>
      <div class="tc-mgr-list" id="tcMgrList">
        <div class="tc-mgr-loading">Loading…</div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('mousedown', e=>{ if(e.target===ov) tcCloseManager(); });
  await _tcRefreshMgrList();
}

function tcCloseManager(){
  document.getElementById('tcManagerOverlay')?.remove();
}

async function _tcRefreshMgrList(){
  const listEl = document.getElementById('tcMgrList');
  if(!listEl) return;
  try{
    const {data, error} = await _tcClient
      .from('tc_projections')
      .select('id,name,season,sort_order,updated_at')
      .eq('user_id', _tcUser.id)
      .order('sort_order', {ascending: false});
    if(error) throw error;
    _tcMgrProjs = data || [];
    _tcRenderMgrList(listEl, _tcMgrProjs);
  }catch(e){
    if(listEl) listEl.innerHTML = `<div class="tc-mgr-empty">Failed to load: ${escHtml(e.message)}</div>`;
  }
}

function _tcRenderMgrList(listEl, projs){
  if(!projs.length){
    listEl.innerHTML = `<div class="tc-mgr-empty">No saved projections yet.<br>
      Use <b>+ Save current projections</b> above to create your first save.</div>`;
    return;
  }
  listEl.innerHTML = '';
  projs.forEach((proj)=>{
    const row = document.createElement('div');
    row.className = 'tc-mgr-row';
    row.draggable = true;
    row.dataset.id = proj.id;
    const dt = new Date(proj.updated_at);
    const now = new Date();
    const sameYear = dt.getFullYear() === now.getFullYear();
    const dateStr = dt.toLocaleDateString('en-US',{month:'short',day:'numeric',...(sameYear?{}:{year:'numeric'})});
    row.innerHTML = `
      <span class="tc-mgr-handle" title="Drag to reorder">⠿</span>
      <span class="tc-mgr-info">
        <span class="tc-mgr-name">${escHtml(proj.name)}</span>
        <span class="tc-mgr-meta">${proj.season?escHtml(proj.season)+' · ':''}${dateStr}</span>
      </span>
      <button class="tc-btn tc-btn-sm tc-btn-load" onclick="tcLoadProjection('${escAttr(proj.id)}')" title="Load">Load</button>
      <button class="tc-btn tc-btn-sm tc-btn-del"  onclick="tcDeleteProjection('${escAttr(proj.id)}')" title="Delete">✕</button>`;
    _tcBindDragRow(row, listEl);
    listEl.appendChild(row);
  });
}

// ── Drag-to-reorder ───────────────────────────────────────────────────────────
let _tcDragSrc = null;

function _tcBindDragRow(row, listEl){
  const handle = row.querySelector('.tc-mgr-handle');
  // Only start drag when handle is the pointer-down target (avoids accidental drags on buttons)
  row.addEventListener('mousedown', e=>{ row.draggable = !!(e.target===handle||handle?.contains(e.target)); });
  row.addEventListener('touchstart', e=>{ row.draggable = !!(e.target===handle||handle?.contains(e.target)); }, {passive:true});

  row.addEventListener('dragstart', e=>{
    if(!row.draggable) return;
    _tcDragSrc = row;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(()=>row.classList.add('tc-mgr-dragging'), 0);
  });
  row.addEventListener('dragend', ()=>{
    row.classList.remove('tc-mgr-dragging');
    listEl.querySelectorAll('.tc-mgr-drop-over').forEach(r=>r.classList.remove('tc-mgr-drop-over'));
    row.draggable = true;
  });
  row.addEventListener('dragover', e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; row.classList.add('tc-mgr-drop-over'); });
  row.addEventListener('dragleave', ()=>row.classList.remove('tc-mgr-drop-over'));
  row.addEventListener('drop', e=>{
    e.preventDefault();
    row.classList.remove('tc-mgr-drop-over');
    if(!_tcDragSrc || _tcDragSrc===row) return;
    const rows = [...listEl.querySelectorAll('.tc-mgr-row')];
    const fromIdx = rows.indexOf(_tcDragSrc);
    const toIdx   = rows.indexOf(row);
    if(fromIdx < 0 || toIdx < 0) return;
    if(fromIdx < toIdx) listEl.insertBefore(_tcDragSrc, row.nextSibling);
    else                listEl.insertBefore(_tcDragSrc, row);
    _tcPersistOrder(listEl);
  });
}

async function _tcPersistOrder(listEl){
  const rows = [...listEl.querySelectorAll('.tc-mgr-row')];
  // Higher sort_order = shown first (we sort descending). Assign in reverse.
  const updates = rows.map((r,i)=>({ id: r.dataset.id, sort_order: (rows.length - i) * 10 }));
  for(const u of updates){
    await _tcClient.from('tc_projections').update({sort_order: u.sort_order}).eq('id', u.id).catch(()=>{});
  }
}

// ── Load / Delete ─────────────────────────────────────────────────────────────
async function tcLoadProjection(id){
  if(!_tcClient || !_tcUser) return;
  const btn = document.querySelector(`.tc-mgr-row[data-id="${id}"] .tc-btn-load`);
  if(btn){ btn.disabled = true; btn.textContent = 'Loading…'; }
  try{
    const {data, error} = await _tcClient
      .from('tc_projections')
      .select('name,data')
      .eq('id', id)
      .eq('user_id', _tcUser.id)
      .single();
    if(error) throw error;
    tcCloseManager();
    loadProjections(data.data);
    const nameEl = document.getElementById('scenarioName');
    if(nameEl) nameEl.value = data.name;
    toast(`Loaded "${data.name}" ✓`, 'ok');
  }catch(e){
    if(btn){ btn.disabled = false; btn.textContent = 'Load'; }
    toast('Load failed: '+(e.message||'unknown error'), 'err');
  }
}

async function tcDeleteProjection(id){
  const row  = document.querySelector(`.tc-mgr-row[data-id="${id}"]`);
  const name = row?.querySelector('.tc-mgr-name')?.textContent || 'this projection';
  if(!confirm(`Delete "${name}"?\n\nThis cannot be undone.`)) return;
  if(!_tcClient || !_tcUser) return;
  const {error} = await _tcClient
    .from('tc_projections')
    .delete()
    .eq('id', id)
    .eq('user_id', _tcUser.id);
  if(error){ toast('Delete failed: '+error.message, 'err'); return; }
  _tcMgrProjs = _tcMgrProjs.filter(p=>p.id!==id);
  row?.remove();
  const listEl = document.getElementById('tcMgrList');
  if(listEl && !listEl.querySelector('.tc-mgr-row'))
    _tcRenderMgrList(listEl, []);
  toast('Projection deleted', 'ok');
}

// Ensure these functions are on window so inline onclick attributes always reach them.
// Also expose tcMenuSignIn as a single safe entry point for the menu button.
if(typeof window !== 'undefined'){
  window.tcMenuSignIn     = function(){ try{ closeAppMenu(); }catch(e){} tcOpenAuthModal(); };
  window.tcOpenAuthModal  = tcOpenAuthModal;
  window.tcCloseAuthModal = tcCloseAuthModal;
  window.tcSwitchAuthTab  = tcSwitchAuthTab;
  window.tcAuthSubmit     = tcAuthSubmit;
  window.tcSignInGoogle   = tcSignInGoogle;
  window.tcSignOut        = tcSignOut;
  window.tcSaveClick      = tcSaveClick;
  window.tcDoSave         = tcDoSave;
  window.tcOpenManager    = tcOpenManager;
  window.tcCloseManager   = tcCloseManager;
  window.tcLoadProjection = tcLoadProjection;
  window.tcDeleteProjection = tcDeleteProjection;
}
