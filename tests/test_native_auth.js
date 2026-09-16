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
  return { signIn:tcSignInGoogle, handle:tcHandleNativeAuthUrl, bind:tcBindNativeAuthReturn, isNative:tcIsNativeApp, redirect:TC_NATIVE_AUTH_REDIRECT, buildLine:tcBuildLine,
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
  // The bridge as the live-site page sees it: no plugin JavaScript bundled, so Plugins is
  // empty; the native headers list what is installed and registerPlugin returns the proxy.
  const natives={
    Browser:{ open:async(o)=>{ calls.browser.push(['open',o.url]); }, close:async()=>{ calls.browser.push(['close']); } },
    App:{ addListener:(ev,fn)=>{ calls.listeners.push(ev); global._appUrl=fn; } } };
  global.window.Capacitor={ isNativePlatform:()=>true, Plugins:{}, PluginHeaders:[{name:'Browser'},{name:'App'},{name:'WebView'}],
    registerPlugin:(name)=>{ calls.registered=(calls.registered||[]).concat(name); return natives[name]; } };
  chk(app.isNative()===true, 'the bridge says native');
  app.signIn(); await new Promise(r=>setTimeout(r,5));
  const o=calls.oauth[1];
  chk(o && o.options.redirectTo==='https://sengi12.github.io/triplecrown/native-auth.html' && o.options.skipBrowserRedirect===true && app.redirect==='com.sengi.triplecrown://auth/callback', 'asks Supabase for the URL only, sending the browser to the site\'s return page (which hops to the app\'s scheme)');
  chk(calls.browser.some(c=>c[0]==='open' && /accounts\.google\.com/.test(c[1])) && opened.length===0, 'opens Google in the system browser (a Custom Tab), not a window');
  chk(calls.listeners.includes('appUrlOpen'), 'listens for the app being opened by a URL');
  chk((calls.registered||[]).includes('Browser') && (calls.registered||[]).includes('App'), 'the plugins are reached through registerPlugin, since the page bundles no plugin JavaScript');
  global.window.Capacitor.PluginHeaders=[{name:'WebView'}];
  chk(app.isNative()===true && (()=>{ let t=null; try{ t=(new Function(code+'return _tcNativePlugin;'))()('Browser'); }catch(e){} return t===null; })(), 'a plugin the shell does not carry is null, not a proxy that would throw later');
  global.window.Capacitor.PluginHeaders=[{name:'Browser'},{name:'App'}];
  await global._appUrl({url:'com.sengi.triplecrown://auth/callback?code=abc123'});
  chk(calls.exchanged[0]==='abc123' && calls.browser.some(c=>c[0]==='close') && closed.length===1 && toasts.includes('ok:Signed in'), 'the code comes back, the browser closes, the session is exchanged, the modal closes');
  chk(await app.handle('https://sengi12.github.io/triplecrown/?code=zzz')===false && calls.exchanged.length===1, 'a URL that is not the callback is ignored');
  await app.handle('com.sengi.triplecrown://auth/callback#access_token=at&refresh_token=rt');
  chk(calls.sessions[0] && calls.sessions[0].access_token==='at' && calls.sessions[0].refresh_token==='rt', 'an implicit-flow return (tokens in the hash) sets the session');
  await app.handle('com.sengi.triplecrown://auth/callback?error=access_denied&error_description=Denied');
  chk(toasts.some(t=>/err:Google sign-in failed: Denied/.test(t)), 'a refusal is reported, not swallowed');
  console.log('=== the bridge a remote page really gets: no registerPlugin, nativePromise + addListener ===');
  calls.oauth.length=0; calls.browser.length=0; calls.listeners.length=0;
  global.window.Capacitor={ isNativePlatform:()=>true, Plugins:{}, PluginHeaders:[{name:'Browser',methods:[{name:'open'},{name:'close'}]},{name:'App',methods:[{name:'addListener'}]},{name:'WebView'}],
    nativePromise:async(plugin,method,opts)=>{ calls.browser.push([plugin+'.'+method, opts&&opts.url]); },
    addListener:(plugin,ev,fn)=>{ calls.listeners.push(plugin+':'+ev); global._appUrl=fn; } };
  const fresh=(new Function(code+"toast=function(m,t){ toasts.push(t+':'+m); }; return {signIn:tcSignInGoogle, setClient:(c)=>{ _tcClient=c; }, plugin:_tcNativePlugin, closeModal:()=>{ tcCloseAuthModal=function(){ closed.push(1); }; }};"))();
  fresh.setClient(client); fresh.closeModal();
  chk(fresh.plugin('Browser') && typeof fresh.plugin('Browser').open==='function' && fresh.plugin('Camera')===null, 'a plugin the shell carries becomes a shim over nativePromise; one it does not is null');
  fresh.signIn(); await new Promise(r=>setTimeout(r,5));
  chk(calls.browser.some(c=>c[0]==='Browser.open' && /accounts\.google\.com/.test(c[1])) && calls.listeners.includes('App:appUrlOpen') && opened.length===0, 'the sign-in opens the system browser through the bridge and listens for the return through it');
  await global._appUrl({url:'com.sengi.triplecrown://auth/callback?code=fromshim'});
  chk(calls.exchanged.includes('fromshim') && calls.browser.some(c=>c[0]==='Browser.close'), 'the return trip closes the browser and exchanges the code');
  console.log('=== a cold relaunch delivers the callback as the launch URL ===');
  calls.exchanged.length=0;
  global.window.Capacitor={ isNativePlatform:()=>true, Plugins:{}, PluginHeaders:[{name:'Browser'},{name:'App'}],
    nativePromise:async(plugin,method,opts)=>{ calls.browser.push([plugin+'.'+method]); if(plugin==='App'&&method==='getLaunchUrl') return {url:'com.sengi.triplecrown://auth/callback?code=launched'}; },
    addListener:(plugin,ev,fn)=>{ calls.listeners.push(plugin+':'+ev); global._appUrl=fn; } };
  const cold=(new Function(code+"toast=function(m,t){ toasts.push(t+':'+m); }; return {bind:tcBindNativeAuthReturn, setClient:(c)=>{ _tcClient=c; }, closeModal:()=>{ tcCloseAuthModal=function(){ closed.push(1); }; }};"))();
  cold.setClient(client); cold.closeModal(); cold.bind(); await new Promise(r=>setTimeout(r,10));
  chk(calls.exchanged.includes('launched') && toasts.includes('info:Finishing sign-in…'), 'the launch URL is read at bind time and the code exchanged, with a visible "finishing" note');
  await global._appUrl({url:'com.sengi.triplecrown://auth/callback?code=launched'});
  chk(calls.exchanged.filter(c=>c==='launched').length===1, 'the same callback arriving twice (event + launch URL) is exchanged once');
  await global._appUrl({url:'com.sengi.triplecrown://auth/callback'});
  chk(toasts.some(t=>/without a session/.test(t)), 'a callback with neither a code nor tokens says so');
  console.log('=== the return page and the build line ===');
  const page=fs.readFileSync(require('path').join(__dirname,'..','native-auth.html'),'utf8');
  chk(/com\.sengi\.triplecrown:\/\/auth\/callback/.test(page) && /location\.search/.test(page) && /location\.hash/.test(page) && /id="open"/.test(page) && /location\.href=app/.test(page), 'native-auth.html forwards the query and hash to the app\'s scheme, by itself and by a button');
  chk(/native-auth\.html/.test(fs.readFileSync(require('path').join(__dirname,'..','.github/workflows/pages.yml'),'utf8')), 'the Pages deploy copies the return page');
  chk(typeof app.buildLine==='function' && app.buildLine()==='' , 'an unstamped build prints no build line');
  const src=fs.readFileSync(require('path').join(__dirname,'..','mobile/android/app/src/main/AndroidManifest.xml'),'utf8');
  chk(/android:scheme="com\.sengi\.triplecrown" android:host="auth"/.test(src) && /android\.intent\.category\.BROWSABLE/.test(src), 'the Android manifest routes the callback scheme to the app');
  const pk=JSON.parse(fs.readFileSync(require('path').join(__dirname,'..','mobile/package.json'),'utf8'));
  chk(pk.dependencies['@capacitor/browser'] && pk.dependencies['@capacitor/app'], 'the Browser and App plugins are part of the shell');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
