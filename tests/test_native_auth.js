// Google sign-in inside the phone app (the Capacitor shell): the OAuth page opens in the
// system browser, the code comes back on the app's own URL scheme, and the SDK exchanges
// it — instead of the browser navigation that left the app for good.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',hidden:false,textContent:'',className:'',style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},appendChild(){}};return elStore[id];}
global.document={getElementById:mkEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('x'+Math.random()),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){}};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),location:{href:'https://sengi12.github.io/triplecrown/#x'},open(){ opened.push('window'); }};
global.Chart=function(){return{destroy(){}}};global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.URL=require('url').URL; global.URLSearchParams=require('url').URLSearchParams;
const opened=[];
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(m,t){ toasts.push(t+':'+m); };
  return { signIn:tcSignInGoogle, handle:tcHandleNativeAuthUrl, bind:tcBindNativeAuthReturn, isNative:tcIsNativeApp, redirect:TC_NATIVE_AUTH_REDIRECT,
    setClient:(c)=>{ _tcClient=c; }, closeModal:()=>{ tcCloseAuthModal=function(){ closed.push(1); }; } };
`)();
global.toasts=[]; global.closed=[];
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const calls={oauth:[], browser:[], listeners:[], exchanged:[], sessions:[]};
const client={auth:{
  signInWithOAuth:async(o)=>{ calls.oauth.push(o); return {data:{url:'https://accounts.google.com/o/oauth2/auth?x=1'}, error:null}; },
  exchangeCodeForSession:async(c)=>{ calls.exchanged.push(c); return {error:null}; },
  setSession:async(s)=>{ calls.sessions.push(s); return {error:null}; },
}};
app.setClient(client); app.closeModal();

(async()=>{
  console.log('=== in a browser: the page navigation, as before ===');
  chk(app.isNative()===false, 'no Capacitor bridge → not the phone app');
  app.signIn(); await new Promise(r=>setTimeout(r,5));
  chk(calls.oauth.length===1 && calls.oauth[0].options.redirectTo==='https://sengi12.github.io/triplecrown/' && !calls.oauth[0].options.skipBrowserRedirect, 'redirects back to the page URL and lets the SDK navigate');

  console.log('=== in the phone app: the system browser, and the code on the app\'s own scheme ===');
  global.window.Capacitor={ isNativePlatform:()=>true, Plugins:{
    Browser:{ open:async(o)=>{ calls.browser.push(['open',o.url]); }, close:async()=>{ calls.browser.push(['close']); } },
    App:{ addListener:(ev,fn)=>{ calls.listeners.push(ev); global._appUrl=fn; } } } };
  chk(app.isNative()===true, 'the bridge says native');
  app.signIn(); await new Promise(r=>setTimeout(r,5));
  const o=calls.oauth[1];
  chk(o && o.options.redirectTo===app.redirect && o.options.skipBrowserRedirect===true && app.redirect==='com.sengi.triplecrown://auth/callback', 'asks Supabase for the URL only, with the app\'s own callback');
  chk(calls.browser.some(c=>c[0]==='open' && /accounts\.google\.com/.test(c[1])) && opened.length===0, 'opens Google in the system browser (a Custom Tab), not a window');
  chk(calls.listeners.includes('appUrlOpen'), 'listens for the app being opened by a URL');
  await global._appUrl({url:'com.sengi.triplecrown://auth/callback?code=abc123'});
  chk(calls.exchanged[0]==='abc123' && calls.browser.some(c=>c[0]==='close') && closed.length===1 && toasts.includes('ok:Signed in'), 'the code comes back, the browser closes, the session is exchanged, the modal closes');
  chk(await app.handle('https://sengi12.github.io/triplecrown/?code=zzz')===false && calls.exchanged.length===1, 'a URL that is not the callback is ignored');
  await app.handle('com.sengi.triplecrown://auth/callback#access_token=at&refresh_token=rt');
  chk(calls.sessions[0] && calls.sessions[0].access_token==='at' && calls.sessions[0].refresh_token==='rt', 'an implicit-flow return (tokens in the hash) sets the session');
  await app.handle('com.sengi.triplecrown://auth/callback?error=access_denied&error_description=Denied');
  chk(toasts.some(t=>/err:Google sign-in failed: Denied/.test(t)), 'a refusal is reported, not swallowed');
  const src=fs.readFileSync(require('path').join(__dirname,'..','mobile/android/app/src/main/AndroidManifest.xml'),'utf8');
  chk(/android:scheme="com\.sengi\.triplecrown" android:host="auth"/.test(src) && /android\.intent\.category\.BROWSABLE/.test(src), 'the Android manifest routes the callback scheme to the app');
  const pk=JSON.parse(fs.readFileSync(require('path').join(__dirname,'..','mobile/package.json'),'utf8'));
  chk(pk.dependencies['@capacitor/browser'] && pk.dependencies['@capacitor/app'], 'the Browser and App plugins are part of the shell');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
