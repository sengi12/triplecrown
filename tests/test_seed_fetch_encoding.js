// ═══════════════════════════════════════════════════════════════════════════
// fetchSeedJson() vs. the two ways a static host can serve a .json.gz.
//
//   GitHub Pages  → Content-Type: application/gzip, NO Content-Encoding.
//                   The body arrives still gzipped; WE inflate it.
//   Vercel / Cloudflare / nginx gzip_static → Content-Encoding: gzip.
//                   The browser inflates it transparently; the body is already text.
//
// Piping an already-inflated body through DecompressionStream throws, which dropped
// the old code into its plain-.json fallback. Deploys that ship only .gz sidecars
// (ours does — see .github/workflows/pages.yml) answer that with a 404, so the whole
// seed silently vanished: no ECR, no contracts, no Sharp, no projections, and a UI
// that looked like it merely couldn't reach Sleeper.
// ═══════════════════════════════════════════════════════════════════════════

const zlib=require('zlib');
const PAYLOAD={ecr:{half_ppr:{'joe burrow':{rank_ecr:40,tier:5}}},seed:{CIN:{QB:[],WR:[],RB:[],TE:[]}}};
const TEXT=JSON.stringify(PAYLOAD);
const GZ=zlib.gzipSync(Buffer.from(TEXT));

global.document={getElementById:()=>({innerHTML:'',style:{},classList:{add(){},remove(){}}}),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},createElement:()=>({style:{},appendChild(){}}),body:{appendChild(){},removeChild(){}}};
global.window={addEventListener(){},getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.Chart=function(){return{destroy(){},update(){}}};
global.confirm=()=>true; global.btoa=s=>s; global.FileReader=function(){}; global.Range=function(){};
global.AbortController=class{constructor(){this.signal={}}abort(){}};

// Track every URL asked for, so we can prove there is no wasteful second request.
let asked=[];
function mkFetch(mode){
  return (url)=>{
    asked.push(String(url));
    if(!String(url).endsWith('.gz')) return Promise.resolve({ok:false,status:404});
    if(mode==='host-encoded'){
      // Browser already inflated it: headers advertise the encoding, body is plain text.
      return Promise.resolve({
        ok:true, status:200,
        headers:{get:(k)=>k.toLowerCase()==='content-encoding'?'gzip':null},
        body:{pipeThrough(){ throw new Error('DecompressionStream on already-inflated body'); }},
        text:()=>Promise.resolve(TEXT),
      });
    }
    // Pages-style: opaque gzip bytes, no Content-Encoding — we must inflate.
    return Promise.resolve({
      ok:true, status:200,
      headers:{get:()=>null},
      body:{ _gz:GZ, pipeThrough(stream){ return {_gz:GZ, _stream:stream}; } },
      text:()=>Promise.resolve(GZ.toString('binary')),
    });
  };
}
// Minimal DecompressionStream/Response pair that actually inflates our fake stream.
global.DecompressionStream=function(fmt){ this.format=fmt; };
global.Response=function(streamish){
  this._s=streamish;
  this.text=()=>Promise.resolve(zlib.gunzipSync(streamish._gz).toString('utf8'));
};

const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+'return { fetchSeedJson };')();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

(async ()=>{
  // Unique URLs per phase so the app's own boot-time seed request can't be miscounted here.
  const mine = tag => asked.filter(u=>u.indexOf(tag)>=0);

  console.log('=== host serves .gz opaquely (GitHub Pages) ===');
  asked=[]; global.fetch=mkFetch('opaque');
  let got=await app.fetchSeedJson('seeds/tc_case_opaque.json');
  let m=mine('tc_case_opaque');
  chk(!!(got && got.ecr && got.ecr.half_ppr['joe burrow'].rank_ecr===40), 'seed inflated and parsed');
  chk(m.length===1 && m[0].endsWith('.gz'), 'one request, the .gz (got '+m.length+')');

  console.log('=== host sets Content-Encoding: gzip (Vercel / Cloudflare / nginx) ===');
  asked=[]; global.fetch=mkFetch('host-encoded');
  got=await app.fetchSeedJson('seeds/tc_case_encoded.json');
  m=mine('tc_case_encoded');
  chk(!!(got && got.ecr && got.ecr.half_ppr['joe burrow'].rank_ecr===40),
      'seed still loads when the browser already inflated the body');
  chk(m.length===1, 'no wasted second request to the plain .json (got '+m.length+')');
  chk(!m.some(u=>!u.endsWith('.gz')), 'the plain-.json fallback was not needed');

  console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
  process.exit(pass===total?0:1);
})();
