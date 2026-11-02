import json, subprocess, time, base64, sys, os, urllib.request, copy, tempfile, shutil
from websocket import create_connection
# usage: live_cost_measure.py <label> <baked.html> [fixtures_dir] [out_dir]
#   fixtures_dir holds fx_board.json (an ESPN scoreboard payload) and fx_summary.json (one game's
#   summary); EID below names the game to replay as live. Needs headless Chrome + websocket-client.
S=sys.argv[3] if len(sys.argv)>3 else os.path.dirname(os.path.abspath(__file__))
OUTDIR=sys.argv[4] if len(sys.argv)>4 else S
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=9333+int(os.environ.get('PORTOFF','0'))
board0=json.load(open(S+'/fx_board.json')); summ0=json.load(open(S+'/fx_summary.json'))
EID=os.environ.get('EID','401872992')
plays_all=[]
for d in summ0['drives']['previous']:
    for p in d.get('plays',[]): plays_all.append(p)
def live_board(n):
    b=copy.deepcopy(board0)
    for e in b['events']:
        if e['id']!=EID: continue
        c=e['competitions'][0]
        st={'type':{'id':'2','name':'STATUS_IN_PROGRESS','state':'in','completed':False,'description':'In Progress','detail':'7:14 - 2nd','shortDetail':'7:14 - 2nd'},'period':2,'displayClock':'7:14','clock':434.0}
        e['status']=st; c['status']=st
        lp=plays_all[n-1]
        c['situation']={'down':2,'distance':7,'yardLine':45,'shortDownDistanceText':'2nd & 7','possessionText':'SF 45','isRedZone':False,'homeTimeouts':3,'awayTimeouts':3,
            'lastPlay':{'id':lp['id'],'text':lp.get('text',''),'type':lp.get('type',{}),'scoreValue':lp.get('scoreValue',0),'statYardage':lp.get('statYardage',0),'wallclock':lp.get('wallclock'),'start':lp.get('start',{}),'athletesInvolved':[]}}
        for comp in c['competitors']: comp['score']=str(10 if comp['homeAway']=='home' else 7)
    return b
def live_summary(n):
    s=copy.deepcopy(summ0)
    prev=[]; count=0
    for d in s['drives']['previous']:
        ps=d.get('plays',[]); take=max(0,min(len(ps), n-count)); count+=len(ps)
        if take>0: d['plays']=ps[:take]; prev.append(d)
        if count>=n: break
    s['drives']={'previous':prev[:-1], 'current':prev[-1]} if prev else {'previous':[]}
    try:
        hc=s['header']['competitions'][0]; hc['status']={'type':{'state':'in','name':'STATUS_IN_PROGRESS','detail':'7:14 - 2nd','shortDetail':'7:14 - 2nd'},'period':2,'displayClock':'7:14'}
    except Exception: pass
    return s
class CDP:
    def __init__(self, url): self.ws=create_connection(url, timeout=120); self.i=0; self.req={'board':0,'summary':0,'other':0}; self.t0=time.time(); self.base=120; self.step=20
    def send(self, m, p=None):
        self.i+=1; self.ws.send(json.dumps({'id':self.i,'method':m,'params':p or {}}))
        while True:
            msg=json.loads(self.ws.recv())
            if msg.get('id')==self.i: return msg.get('result',{})
            self.event(msg)
    def nplays(self): return min(len(plays_all), self.base+int((time.time()-self.t0)//self.step))
    def event(self, msg):
        if msg.get('method')!='Fetch.requestPaused': return
        rid=msg['params']['requestId']; url=msg['params']['request']['url']
        body=None
        if 'site.api.espn.com' in url and 'scoreboard' in url: self.req['board']+=1; body=live_board(self.nplays())
        elif 'site.api.espn.com' in url and 'summary' in url: self.req['summary']+=1; body=live_summary(self.nplays())
        if body is None:
            self.req['other']+=1; self.ws.send(json.dumps({'id':0,'method':'Fetch.continueRequest','params':{'requestId':rid}})); return
        b64=base64.b64encode(json.dumps(body).encode()).decode()
        self.ws.send(json.dumps({'id':0,'method':'Fetch.fulfillRequest','params':{'requestId':rid,'responseCode':200,'responseHeaders':[{'name':'Content-Type','value':'application/json'},{'name':'Access-Control-Allow-Origin','value':'*'}],'body':b64}}))
    def pump(self, secs):
        end=time.time()+secs; self.ws.settimeout(1.0)
        while time.time()<end:
            try: msg=json.loads(self.ws.recv())
            except Exception: continue
            if 'id' in msg and msg['id']==0: continue
            self.event(msg)
        self.ws.settimeout(120)
    def ev(self, expr, await_=False):
        r=self.send('Runtime.evaluate', {'expression':expr,'returnByValue':True,'awaitPromise':await_}); return r.get('result',{}).get('value')
def run(label, html):
    prof=tempfile.mkdtemp()
    chrome=subprocess.Popen([CH,'--headless=new','--remote-debugging-port=%d'%PORT,'--user-data-dir='+prof,'--no-first-run','--remote-allow-origins=*','--allow-file-access-from-files','--hide-scrollbars','--window-size=390,844','--force-dark-mode'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try: targets=json.load(urllib.request.urlopen('http://localhost:%d/json'%PORT)); break
            except Exception: time.sleep(0.3)
        page=[t for t in targets if t['type']=='page'][0]
        c=CDP(page['webSocketDebuggerUrl'])
        c.send('Fetch.enable', {'patterns':[{'urlPattern':'*site.api.espn.com/*','requestStage':'Request'}]})
        c.send('Emulation.setDeviceMetricsOverride', {'width':390,'height':844,'deviceScaleFactor':2,'mobile':True})
        c.send('Emulation.setUserAgentOverride', {'userAgent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'})
        c.send('Emulation.setTouchEmulationEnabled', {'enabled':True})
        c.send('Performance.enable'); c.send('Page.enable'); c.send('Runtime.enable')
        c.send('Page.navigate', {'url':'file://'+html})
        for _ in range(120):
            c.pump(1)
            if c.ev("typeof buildProjectionList==='function' && (function(){ try{ return buildProjectionList().length>100; }catch(e){ return false; } })()"): break
        c.ev("try{ TC_SEASON.phase='regular'; }catch(e){}; try{ showGamesView(); }catch(e){}; 'ok'"); c.pump(3)
        c.ev("try{ gcPick('SF@SEA'); }catch(e){}; 'ok'"); c.pump(4)
        state=c.ev("JSON.stringify({phase:currentPhase, game:_gc.game, week:gcWeek(), live:(tcWeekBoard()||{}).SF&&tcWeekBoard().SF.state, feedRows:document.querySelectorAll('.gcf-row').length, nodes:document.querySelectorAll('*').length, poll:GC_LIVE_POLL})")
        print(label, 'state', state)
        c.ev("window.__mut={added:0,removed:0,text:0,attr:0}; new MutationObserver(ms=>{ for(const m of ms){ if(m.type==='childList'){ __mut.added+=m.addedNodes.length; __mut.removed+=m.removedNodes.length; } else if(m.type==='characterData') __mut.text++; else __mut.attr++; } }).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true}); 'ok'")
        m0={m['name']:m['value'] for m in c.send('Performance.getMetrics')['metrics']}; r0=dict(c.req); t0=time.time()
        c.pump(90)
        m1={m['name']:m['value'] for m in c.send('Performance.getMetrics')['metrics']}; r1=dict(c.req); el=time.time()-t0
        mut=json.loads(c.ev("JSON.stringify(__mut)"))
        out={'label':label,'secs':round(el,1),'requests':{k:r1[k]-r0[k] for k in r1}, 'mutations':mut,
             'metrics':{k:round(m1[k]-m0[k],3) for k in ('LayoutCount','RecalcStyleCount','LayoutDuration','RecalcStyleDuration','ScriptDuration','TaskDuration')},
             'nodes_end':m1.get('Nodes'), 'heapMB':round(m1.get('JSHeapUsedSize',0)/1e6,1), 'feedRows':c.ev("document.querySelectorAll('.gcf-row').length")}
        try:
            shot=c.send('Page.captureScreenshot', {'format':'png'})
            open(os.path.join(OUTDIR, 'shot_%s.png'%label),'wb').write(base64.b64decode(shot['data']))
        except Exception as e: print('screenshot failed', e)
        print(json.dumps(out)); return out
    finally:
        chrome.terminate(); shutil.rmtree(prof, ignore_errors=True)
if __name__=='__main__':
    res=[run(sys.argv[1], sys.argv[2])]
    json.dump(res, open(os.path.join(OUTDIR,'measure_%s.json'%sys.argv[1]),'w'))
