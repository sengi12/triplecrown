// The installable-app surface: the web manifest the stores' shells and "add to home
// screen" read, its icons on disk and in the Pages deploy, and the Capacitor shell's config.
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

console.log('=== the web manifest ===');
const m=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.webmanifest'),'utf8'));
chk(m.id && m.name==='TripleCrown' && m.short_name && m.display==='standalone' && m.start_url && m.scope, 'id, names, standalone display, start_url and scope');
const icons=m.icons||[];
const sq=(s)=>{ const [w,h]=String(s).split('x').map(Number); return w===h; };
chk(icons.some(i=>i.sizes==='192x192' && sq(i.sizes)) && icons.some(i=>i.sizes==='512x512' && i.purpose==='any'), 'square 192 and 512 icons for install prompts and the stores');
chk(icons.some(i=>i.sizes==='512x512' && i.purpose==='maskable'), 'a maskable 512 icon for Android launchers');
chk(icons.every(i=>fs.existsSync(path.join(ROOT,i.src))), 'every icon the manifest names exists in images/');
const png=(f)=>{ const b=fs.readFileSync(path.join(ROOT,f)); return {w:b.readUInt32BE(16), h:b.readUInt32BE(20)}; };
chk(png('images/icon-512.png').w===512 && png('images/icon-512.png').h===512 && png('images/icon-192.png').w===192, 'the square icons are the size they claim');
chk(fs.existsSync(path.join(ROOT,'images/icon-1024.png')) && png('images/icon-1024.png').w===1024, 'a 1024 source for the native shells\' icon generators');
const pages=fs.readFileSync(path.join(ROOT,'.github/workflows/pages.yml'),'utf8');
chk(['icon-192.png','icon-512.png','icon-512-maskable.png'].every(f=>pages.includes(f)) && pages.includes('manifest.webmanifest'), 'the Pages deploy copies the icons and the manifest');
const tpl=fs.readFileSync(path.join(ROOT,'src/index.template.html'),'utf8');
chk(/rel="manifest" href="manifest.webmanifest"/.test(tpl) && /theme-color/.test(tpl), 'the page links the manifest and sets a theme colour');

console.log('=== the Capacitor shell ===');
const cap=JSON.parse(fs.readFileSync(path.join(ROOT,'mobile/capacitor.config.json'),'utf8'));
chk(cap.appId==='com.sengi.triplecrown' && cap.appName==='TripleCrown' && cap.webDir==='www', 'app id, name and web dir');
chk(cap.server && cap.server.url==='https://sengi12.github.io/triplecrown/' && cap.server.androidScheme==='https' && cap.server.cleartext===false, 'the shell loads the live site over https, no cleartext');
chk(fs.existsSync(path.join(ROOT,'mobile/www/index.html')) && fs.existsSync(path.join(ROOT,'mobile/package.json')), 'the placeholder page and package manifest exist');
const gi=fs.readFileSync(path.join(ROOT,'.gitignore'),'utf8');
chk(gi.includes('mobile/node_modules/') && gi.includes('mobile/*.jks') && gi.includes('mobile/android/local.properties'), 'installed packages, keystores and the local SDK path stay out of the repo');

console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
process.exit(pass===total?0:1);
