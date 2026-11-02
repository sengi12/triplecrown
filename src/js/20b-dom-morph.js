// ═════════════════════════════════════════════════════════════════════════════
// tcMorph — patch a live DOM subtree to match new markup, touching only what changed.
//
// The live surfaces (the Games view, the sidebar, the Leaders panel) are rendered as HTML
// strings and used to land with `host.innerHTML = html` every few seconds while a game was
// on. That threw the whole subtree away each time — 100–200 KB of markup re-parsed, every
// node re-styled, laid out and painted — and on a phone that is the heat. This walks the
// new markup against the old tree and makes the smallest edits that line them up: text that
// changed, an attribute that changed, a row that arrived. Everything else is left alone, so
// the browser repaints a score and a new row, not a page.
//
// Keys: an element with `data-key` (or an id) is matched by that key within its parent, so
// a feed that gains a row at the top inserts one node instead of rewriting every row below
// it. Unkeyed siblings match by position and tag. A focused form control keeps the value
// the user is typing. The render functions themselves are unchanged — they still build the
// full string; only the hand-off to the DOM is different.
// ═════════════════════════════════════════════════════════════════════════════
function tcMorph(host, html){
  if(!host) return;
  if(typeof document==='undefined' || !document.createElement || !host.childNodes || !host.insertBefore){ host.innerHTML=html; return; }
  let tpl;
  try{ tpl=document.createElement('template'); tpl.innerHTML=html; }catch(e){ host.innerHTML=html; return; }
  if(!tpl.content){ host.innerHTML=html; return; }   // no <template> support: the old way
  _tcMorphChildren(host, tpl.content);
}
function _tcMorphKey(n){
  if(!n || n.nodeType!==1) return '';
  const k=n.getAttribute && n.getAttribute('data-key');
  return k || n.id || '';
}
function _tcMorphSame(f, t){
  if(!f || f.nodeType!==t.nodeType) return false;
  if(t.nodeType===1) return f.tagName===t.tagName && _tcMorphKey(f)===_tcMorphKey(t);
  return true;
}
function _tcMorphChildren(from, to){
  const keyed={};
  for(let n=from.firstChild; n; n=n.nextSibling){ const k=_tcMorphKey(n); if(k && !keyed[k]) keyed[k]=n; }
  let f=from.firstChild, t=to.firstChild;
  while(t){
    const next=t.nextSibling;
    const tk=_tcMorphKey(t);
    let match=null;
    if(tk){ const k=keyed[tk]; if(k && k.tagName===t.tagName) match=k; }
    else if(f && !_tcMorphKey(f) && _tcMorphSame(f, t)) match=f;
    if(match){
      if(match!==f) from.insertBefore(match, f);   // the keyed node belongs here now
      _tcMorphNode(match, t);
      f=match.nextSibling;
    } else {
      from.insertBefore(t, f);                      // new: adopted straight out of the template
    }
    t=next;
  }
  while(f){ const n=f.nextSibling; from.removeChild(f); f=n; }
}
function _tcMorphNode(f, t){
  if(t.nodeType!==1){ if(f.nodeValue!==t.nodeValue) f.nodeValue=t.nodeValue; return; }
  // attributes: set what differs, drop what is gone
  const ta=t.attributes, fa=f.attributes;
  for(let i=0; i<ta.length; i++){ const a=ta[i]; if(f.getAttribute(a.name)!==a.value) f.setAttribute(a.name, a.value); }
  for(let i=fa.length-1; i>=0; i--){ const a=fa[i]; if(!t.hasAttribute(a.name)) f.removeAttribute(a.name); }
  const tag=t.tagName;
  if(tag==='INPUT' || tag==='SELECT' || tag==='TEXTAREA'){
    const focused = typeof document!=='undefined' && document.activeElement===f;
    if(!focused){
      if(tag==='INPUT' && (t.type==='checkbox' || t.type==='radio')){ if(f.checked!==t.checked) f.checked=t.checked; }
      else if(f.value!==t.value) f.value=t.value;
    }
    if(tag!=='SELECT') return;   // an input has no children worth walking
  }
  if(tag==='SCRIPT' || tag==='STYLE'){ if(f.textContent!==t.textContent) f.textContent=t.textContent; return; }
  _tcMorphChildren(f, t);
}
