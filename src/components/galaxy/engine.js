// Goal Galaxy 3D scene, ported from the standalone Goal Galaxy.html.
// startGalaxy() builds the whole scene and UI inside `root` and returns a dispose function that
// tears it all down (React may mount it twice in dev). Goals are saved through server actions
// passed in as `api` instead of an Excel file.
/* eslint-disable */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { MARKUP } from './markup.js';

export function startGalaxy(root, { initialGoals, initialSocial, initialMultiverses, user, api, readOnly=false }) {
  root.innerHTML = MARKUP;
  const ac = new AbortController(), signal = ac.signal;   // removes window/document listeners on dispose
  const $ = id => root.querySelector('#' + id);

  // ---------- constants ----------
  const COLORS={high:'#ff5d5d',medium:'#ffb648',low:'#5da9ff'};
  const DONE_COLOR='#6dffb0';
  const RINGS={short:12,mid:21,long:30};
  // each ring is a stretch of time laid clockwise from its start mark over 90% of the circle;
  // the last 10% is a gap holding "later" (beyond the ring's span) and "past" (target date gone by)
  const SPANS={short:{unit:'month',count:12,label:'12 months'},mid:{unit:'year',count:5,label:'5 years'},long:{unit:'year',count:15,label:'15 years'}};
  const ARC_END=0.9, LATER_FRAC=0.93, PAST_FRAC=0.965;
  const PLANET_R={high:1.0,medium:0.75,low:0.55};
  const NOTES_MAX=100000;

  let goals=initialGoals.map(g=>({...g}));

  // ---------- dates (all local calendar dates, stored as YYYY-MM-DD) ----------
  const pad=n=>String(n).padStart(2,'0');
  function toISO(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function todayISO(){ return toISO(new Date()); }
  function isoToDate(iso){
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');
    return m? new Date(+m[1],+m[2]-1,+m[3]) : new Date();
  }
  function today(){ return isoToDate(todayISO()); }
  const EXCEL_EPOCH=Date.UTC(1899,11,30);
  function serialToISO(n){
    const d=new Date(EXCEL_EPOCH+Math.round(n)*86400000);
    return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());
  }
  function isoToSerial(iso){
    const [y,m,d]=iso.split('-').map(Number);
    return Math.round((Date.UTC(y,m-1,d)-EXCEL_EPOCH)/86400000);
  }
  function ymd(y,m,d){
    const dt=new Date(y,m-1,d);
    return (dt.getFullYear()===y && dt.getMonth()===m-1 && dt.getDate()===d)? y+'-'+pad(m)+'-'+pad(d) : null;
  }
  const MONTH_FIRST=/-US$/i.test(navigator.language||'');
  // accepts Excel date serials, Date objects, YYYY-MM-DD, DD/MM/YYYY (MM/DD in US locales) and other parseable text
  function normalizeDate(v){
    if(v==null || v==='') return null;
    if(v instanceof Date) return isNaN(v)? null : toISO(v);
    if(typeof v==='number'){ return (isFinite(v) && v>1000 && v<200000)? serialToISO(v) : null; }
    const s=String(v).trim();
    let m;
    if((m=/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s))) return ymd(+m[1],+m[2],+m[3]);
    if((m=/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(s))){
      const a=+m[1], b=+m[2]; let y=+m[3]; if(y<100) y+=2000;
      let day=a, mon=b;
      if(a>12){ day=a; mon=b; } else if(b>12 || MONTH_FIRST){ mon=a; day=b; }
      return ymd(y,mon,day);
    }
    if(/^\d+(\.\d+)?$/.test(s)) return normalizeDate(Number(s));
    const t=new Date(s);
    return isNaN(t)? null : toISO(t);
  }

  // ---------- tolerant value mapping for hand-edited spreadsheets ----------
  const IMPORTANCE_ALIASES={high:'high',h:'high',urgent:'high',critical:'high','3':'high',
    medium:'medium',med:'medium',m:'medium',normal:'medium','2':'medium',
    low:'low',l:'low','not necessary':'low',notnecessary:'low',optional:'low','1':'low'};
  const TIMEFRAME_ALIASES={short:'short','short term':'short','short-term':'short',s:'short',
    mid:'mid','mid term':'mid','mid-term':'mid',medium:'mid','medium term':'mid',m:'mid',
    long:'long','long term':'long','long-term':'long',l:'long'};
  const STATUS_ALIASES={ongoing:'ongoing','in progress':'ongoing',active:'ongoing',open:'ongoing','':'ongoing',
    done:'done',completed:'done',complete:'done',achieved:'done',yes:'done','✓':'done',true:'done',
    notdone:'notdone','not done':'notdone',failed:'notdone',abandoned:'notdone',dropped:'notdone',no:'notdone',false:'notdone'};
  function pick(map,v,def){
    const k=String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
    return map[k] || def;
  }
  function newId(){ return 'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

  // ---------- timeline placement ----------
  function monthsBetween(a,b){
    return (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth()) + (b.getDate()-a.getDate())/30;
  }
  function suggestTimeframe(iso){
    const m=monthsBetween(today(),isoToDate(iso));
    return m<=12? 'short' : m<=60? 'mid' : 'long';
  }
  function placement(g){
    const span=SPANS[g.timeframe];
    const now=today(), target=isoToDate(g.date);
    if(target<now) return {frac:PAST_FRAC, state:'past'};
    const months=monthsBetween(now,target);
    const f=(span.unit==='month'? months : months/12)/span.count;
    if(f>1) return {frac:LATER_FRAC, state:'later'};
    return {frac:f*ARC_END, state:'ok'};
  }
  function isOverdue(g){ return g.status==='ongoing' && isoToDate(g.date)<today(); }
  function tickLabels(tf){
    const span=SPANS[tf], now=new Date(), step=tf==='long'?3:1, out=[];
    for(let i=0;i<=span.count;i+=step){
      let text;
      if(span.unit==='month'){
        const d=new Date(now.getFullYear(),now.getMonth()+i,1);
        const mo=d.toLocaleString('default',{month:'short'});
        text=(i===0 || i===span.count || d.getMonth()===0)? mo+" '"+String(d.getFullYear()).slice(2) : mo;
      }else text=String(now.getFullYear()+i);
      out.push({frac:i/span.count*ARC_END, text});
    }
    return out;
  }
  function polar(r,th){ return new THREE.Vector3(r*Math.sin(th),0,-r*Math.cos(th)); }
  // positions for every goal; goals that land close together on a ring are fanned out radially
  function computeLayout(list){
    const out=new Map(), byRing={short:[],mid:[],long:[]};
    list.forEach(g=>{
      const p=placement(g), it={g,state:p.state,theta:p.frac*Math.PI*2};
      if(g.status==='notdone') out.set(g.id,{pos:polar(RINGS[g.timeframe],it.theta),state:p.state});   // lives in the black hole
      else byRing[g.timeframe].push(it);
    });
    for(const tf in byRing){
      const R=RINGS[tf], list=byRing[tf].sort((a,b)=>a.theta-b.theta);
      let k=0;
      list.forEach((it,i)=>{
        k = (i>0 && (it.theta-list[i-1].theta)*R<2.6)? k+1 : 0;
        const off = k===0? 0 : (k%2? 1 : -1)*Math.ceil(k/2)*1.9;
        out.set(it.g.id,{pos:polar(R+off,it.theta), state:it.state});
      });
    }
    return out;
  }

  // ---------- toast ----------
  let toastTimer=null;
  function showToast(msg,opts={}){
    $('toastMsg').textContent=msg;
    const b=$('toastAction');
    if(opts.label){ b.textContent=opts.label; b.style.display=''; b.onclick=()=>{ hideToast(); opts.action(); }; }
    else b.style.display='none';
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    if(!opts.sticky) toastTimer=setTimeout(hideToast,opts.timeout||4000);
  }
  function hideToast(){ $('toast').classList.remove('show'); }
  $('toastX').addEventListener('click',hideToast);


  // ---------- storage: the signed-in user's goals in the database ----------
  // Edits update the scene at once; the matching server call runs in the background, one at a time,
  // so quick edits never overtake each other.
  let pendingSaves=0, saveChain=Promise.resolve(), disposed=false;
  function renderSaveStatus(){ $('saveStatus').textContent=pendingSaves>0?'saving…':''; }
  function cleanGoal(g){
    const {id,name,category,importance,timeframe,date,status,notes,isPrivate,limited,sharedWith,why}=g;
    return {id,name,category,importance,timeframe,date,status,notes:notes||'',isPrivate:!!isPrivate,limited:!!limited&&!isPrivate,sharedWith:limited?(sharedWith||[]):[],why:why||''};
  }
  // a new goal carries empty extras until the server fills them in
  const EMPTY_EXTRAS=()=>({limited:false,sharedWith:[],why:'',capsule:{state:'none'},steps:[],links:[],guestNotes:[]});
  function persist(op){
    pendingSaves++; renderSaveStatus();
    saveChain=saveChain.then(async()=>{
      try{
        if(op.type==='delete'){ await api.deleteGoal(op.id); return; }
        const res=await api.saveGoal(op.goal);
        if(!res || res.error) throw new Error(res? res.error : 'no response');
        // adopt the server's cleaned-up copy (e.g. sanitised notes) unless the goal was edited again meanwhile
        const g=goals.find(x=>x.id===res.goal.id);
        if(g && JSON.stringify(cleanGoal(g))===JSON.stringify(op.goal)) Object.assign(g,res.goal);
      }catch(e){
        console.error(e);
        if(!disposed) showToast("Couldn't save your change. Check your connection and retry.",{label:'Retry',action:()=>persist(op),sticky:true});
      }
    }).finally(()=>{ pendingSaves--; if(!disposed) renderSaveStatus(); });
  }
  // pick up changes made on another device or tab
  async function refreshFromServer(){
    if(disposed || readOnly || pendingSaves>0 || document.hidden) return;
    let fresh;
    try{ fresh=await api.listGoals(); }catch(e){ return; }
    if(disposed || pendingSaves>0 || !Array.isArray(fresh)) return;
    applyFreshGoals(fresh);
    refreshSocial();
    refreshMultiverses();
  }
  // steps, notes and suggestions can change from elsewhere, so compare everything
  function applyFreshGoals(fresh){
    if(JSON.stringify(fresh)===JSON.stringify(goals)) return;
    goals=fresh; syncScene('reload');
    if(detailOverlay.classList.contains('show') && detailSys && detailSys.isMe) openDetail(detailId,true);
  }
  let goalsBusy=false;
  async function refreshGoals(){
    if(disposed || readOnly || goalsBusy) return;
    goalsBusy=true;
    try{ const fresh=await api.listGoals(); if(!disposed && pendingSaves===0 && Array.isArray(fresh)) applyFreshGoals(fresh); }
    catch(e){ console.error(e); }
    finally{ goalsBusy=false; }
  }
  addEventListener('focus',refreshFromServer,{signal});
  const refreshTimer=setInterval(refreshFromServer,30000);
  $('whoPill').textContent='👤 '+user.name;
  const myId=user.id;
  $('logoutBtn').addEventListener('click',()=>{ $('logoutBtn').disabled=true; api.logout(); });

  // ---------- rich-text notes: sanitising and text conversion ----------
  // Notes are stored as a small, safe subset of HTML. Anything else (scripts, styles, images, event
  // attributes, unsafe links) is removed, whether it comes from pasting or stored data.
  const RICH_TAGS={P:'p',DIV:'p',BR:'br',B:'b',STRONG:'b',I:'i',EM:'i',U:'u',S:'s',STRIKE:'s',DEL:'s',
    H1:'h3',H2:'h3',H3:'h3',H4:'h4',H5:'h4',H6:'h4',UL:'ul',OL:'ol',LI:'li',A:'a',BLOCKQUOTE:'blockquote'};
  const RICH_DROP=new Set(['SCRIPT','STYLE','IFRAME','FRAME','OBJECT','EMBED','NOSCRIPT','TEMPLATE','SVG','MATH','HEAD','TITLE',
    'META','LINK','BASE','IMG','PICTURE','VIDEO','AUDIO','SOURCE','TRACK','CANVAS','FORM','INPUT','BUTTON','SELECT','TEXTAREA']);
  function escHtml(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function safeUrl(u){
    u=String(u||'').trim();
    if(/^(https?:\/\/|mailto:)/i.test(u)) return u;
    if(/^www\./i.test(u)) return 'https://'+u;
    if(/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(u)) return 'https://'+u;
    return null;
  }
  // pasted Word / Google Docs text carries formatting as inline styles
  function styleWrappers(n){
    const st=n.getAttribute('style')||'', w=[];
    if(/font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) w.push('b');
    if(/font-style\s*:\s*italic/i.test(st)) w.push('i');
    if(/text-decoration[^;]*underline/i.test(st)) w.push('u');
    if(/text-decoration[^;]*line-through/i.test(st)) w.push('s');
    return w;
  }
  function parseInert(html){ return new DOMParser().parseFromString('<!doctype html><body>'+String(html||'')+'</body>','text/html').body; }
  function sanitizeHtml(html){
    if(!html) return '';
    const out=document.createElement('div');
    const walk=(src,dst)=>{
      for(const n of src.childNodes){
        if(n.nodeType===3){
          if(/^(UL|OL)$/.test(dst.nodeName) && !n.textContent.trim()) continue;
          dst.append(n.textContent); continue;
        }
        const tn=n.nodeName.toUpperCase();   // SVG/MathML element names come through in lower case
        if(n.nodeType!==1 || RICH_DROP.has(tn)) continue;
        let tag=RICH_TAGS[tn];
        // Google Docs wraps whole pastes in <b style="font-weight:normal">
        if(tag==='b' && /font-weight\s*:\s*(normal|[1-5]00)/i.test(n.getAttribute('style')||'')) tag=null;
        let target=dst;
        if(tag==='a'){
          const u=safeUrl(n.getAttribute('href'));
          if(u){
            const a=document.createElement('a');
            a.setAttribute('href',u); a.setAttribute('target','_blank'); a.setAttribute('rel','noopener noreferrer');
            dst.append(a); target=a;
          }
        }else if(tag){
          const el=document.createElement(tag); dst.append(el);
          if(tag==='br') continue;
          target=el;
        }
        for(const w of styleWrappers(n)){ if(w===tag) continue; const el=document.createElement(w); target.append(el); target=el; }
        walk(n,target);
      }
    };
    walk(parseInert(html),out);
    // editing commands can leave empty paragraphs around lists
    out.querySelectorAll('p,h3,h4,blockquote,b,i,u,s').forEach(el=>{ if(!el.hasChildNodes()) el.remove(); });
    return out.innerHTML.trim();
  }
  // readable plain text: paragraphs on their own lines, bullets as "• ", numbered items as "1. "
  function htmlToText(html){
    let out='';
    const nl=()=>{ if(out && !out.endsWith('\n')) out+='\n'; };
    const BLOCK=/^(P|DIV|H[1-6]|BLOCKQUOTE)$/;
    const walk=(node,list)=>{
      for(const n of node.childNodes){
        if(n.nodeType===3){ out+=n.textContent.replace(/\s+/g,' '); continue; }
        if(n.nodeType!==1) continue;
        const t=n.tagName;
        if(t==='BR'){ out+='\n'; continue; }
        if(t==='UL'||t==='OL'){ nl(); walk(n,{ordered:t==='OL',i:0}); nl(); continue; }
        if(t==='LI'){ nl(); out+=list&&list.ordered? (++list.i)+'. ' : '• '; walk(n,null); nl(); continue; }
        if(BLOCK.test(t)){ nl(); walk(n,list); nl(); continue; }
        walk(n,list);
      }
    };
    walk(parseInert(html),null);
    return out.split('\n').map(l=>l.trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  function textToHtml(text){
    let html='', list=null;
    const close=()=>{ if(list){ html+=`</${list}>`; list=null; } };
    for(const raw of String(text||'').replace(/\r\n?/g,'\n').split('\n')){
      const line=raw.trim();
      let m;
      if((m=/^[•\-*]\s+(.*)$/.exec(line))){ if(list!=='ul'){ close(); html+='<ul>'; list='ul'; } html+=`<li>${escHtml(m[1])}</li>`; }
      else if((m=/^\d+[.)]\s+(.*)$/.exec(line))){ if(list!=='ol'){ close(); html+='<ol>'; list='ol'; } html+=`<li>${escHtml(m[1])}</li>`; }
      else{ close(); if(line) html+=`<p>${escHtml(line)}</p>`; }
    }
    close();
    return html;
  }
  function normText(s){ return String(s??'').replace(/\r\n?/g,'\n').split('\n').map(l=>l.trim()).filter(Boolean).join('\n'); }
  // the plain-text "notes" column wins: if it was edited in Excel, the stored formatting is out of date
  function notesFromRow(text,html){
    text=String(text??''); html=String(html??'');
    if(html.trim()){
      const clean=sanitizeHtml(html);
      if(normText(htmlToText(clean))===normText(text)) return clean;
    }
    return normText(text)? textToHtml(text) : '';
  }

  // =====================================================================
  // 3D ENGINE
  // =====================================================================
  const stage=$('stage');
  const isMobile=matchMedia('(pointer:coarse)').matches || Math.min(innerWidth,innerHeight)<600;
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pixelRatio=Math.min(devicePixelRatio||1,isMobile?1.5:2);

  function bootFail(msg){
    const el=$('bootError'); el.textContent=msg; el.style.display='block';
  }
  let renderer;
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  }catch(e){
    bootFail('Goal Galaxy needs WebGL to draw the 3D scene, and this browser or device has it turned off. Try Chrome or Edge with hardware acceleration enabled.');
    console.error(e);
    return ()=>{ disposed=true; ac.abort(); clearInterval(refreshTimer); root.innerHTML=''; };
  }
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth,innerHeight);
  renderer.setClearColor(0x04050d,1);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.05;
  stage.appendChild(renderer.domElement);
  const canvas=renderer.domElement;

  const labelRenderer=new CSS2DRenderer();
  labelRenderer.setSize(innerWidth,innerHeight);
  labelRenderer.domElement.className='labels';
  stage.appendChild(labelRenderer.domElement);

  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,0.1,4000);
  camera.position.set(0,240,480);

  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=true; controls.dampingFactor=0.07;
  controls.rotateSpeed=0.6; controls.zoomSpeed=0.8;
  controls.minDistance=8; controls.maxDistance=320;
  controls.minPolarAngle=0.05; controls.maxPolarAngle=Math.PI*0.49;
  controls.screenSpacePanning=true;
  controls.autoRotate=false; controls.autoRotateSpeed=0.35;

  const composer=new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(innerWidth,innerHeight);
  const renderPass=new RenderPass(scene,camera);   // its scene is swapped when entering a multiverse
  composer.addPass(renderPass);
  const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),isMobile?0.7:0.85,0.5,0.32);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- procedural textures ----------
  function canvasTex(size,draw){
    const c=document.createElement('canvas'); c.width=c.height=size;
    draw(c.getContext('2d'),size);
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
  }
  const GLOW_TEX=canvasTex(128,(g,s)=>{
    const gr=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(0.2,'rgba(255,255,255,.55)');
    gr.addColorStop(0.5,'rgba(255,255,255,.13)'); gr.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle=gr; g.fillRect(0,0,s,s);
  });
  const RING_TEX=canvasTex(128,(g,s)=>{
    g.strokeStyle='rgba(255,255,255,1)'; g.lineWidth=5; g.shadowColor='#fff'; g.shadowBlur=10;
    g.beginPath(); g.arc(s/2,s/2,s/2-14,0,Math.PI*2); g.stroke();
  });
  function mulberry32(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function cloudTex(seed){
    const rng=mulberry32(seed);
    return canvasTex(256,(g,s)=>{
      g.globalCompositeOperation='lighter';
      for(let i=0;i<46;i++){
        const x=s/2+(rng()+rng()-1)*s*0.32, y=s/2+(rng()+rng()-1)*s*0.32, r=18+rng()*70;
        const gr=g.createRadialGradient(x,y,0,x,y,r);
        gr.addColorStop(0,'rgba(255,255,255,.09)'); gr.addColorStop(1,'rgba(255,255,255,0)');
        g.fillStyle=gr; g.fillRect(0,0,s,s);
      }
      g.globalCompositeOperation='destination-in';
      const m=g.createRadialGradient(s/2,s/2,s*0.1,s/2,s/2,s/2);
      m.addColorStop(0,'rgba(0,0,0,1)'); m.addColorStop(1,'rgba(0,0,0,0)');
      g.fillStyle=m; g.fillRect(0,0,s,s);
    });
  }
  // banded gas-giant surface, seeded by goal id so each planet keeps its look
  function planetTexture(hex,seed){
    const rng=mulberry32(seed), W=256, H=128;
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    const g=c.getContext('2d');
    const base=new THREE.Color(hex), white=new THREE.Color(1,1,1);
    const f=[1+rng()*3,3+rng()*6,8+rng()*10], ph=[rng()*6.28,rng()*6.28,rng()*6.28];
    for(let y=0;y<H;y++){
      const v=y/H;
      const n=0.55*Math.sin(v*f[0]*6.283+ph[0])+0.3*Math.sin(v*f[1]*6.283+ph[1])+0.15*Math.sin(v*f[2]*6.283+ph[2]);
      const col=base.clone().multiplyScalar(0.78+n*0.22).lerp(white,Math.max(0,n)*0.12);
      g.fillStyle='#'+col.getHexString(); g.fillRect(0,y,W,1);
    }
    for(let i=0;i<5;i++){
      const x=20+rng()*(W-40), y=H*0.15+rng()*H*0.7, rx=6+rng()*18, light=rng()>0.5;
      g.save(); g.translate(x,y); g.scale(1,0.45);
      const gr=g.createRadialGradient(0,0,0,0,0,rx);
      gr.addColorStop(0,light?'rgba(255,255,255,.35)':'rgba(0,0,0,.3)'); gr.addColorStop(1,'rgba(0,0,0,0)');
      g.fillStyle=gr; g.beginPath(); g.arc(0,0,rx,0,Math.PI*2); g.fill(); g.restore();
    }
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
  }

  // ---------- starfield + nebula ----------
  function makeStarLayer(count,rMin,rMax,sizeMin,sizeMax,attenuate){
    const pos=new Float32Array(count*3), col=new Float32Array(count*3), size=new Float32Array(count), ph=new Float32Array(count);
    const tints=[[1,1,1],[0.75,0.85,1],[1,0.88,0.72],[0.86,0.8,1]];
    for(let i=0;i<count;i++){
      const u=Math.random()*2-1, th=Math.random()*Math.PI*2, s=Math.sqrt(1-u*u), r=rMin+Math.random()*(rMax-rMin);
      pos[i*3]=r*s*Math.cos(th); pos[i*3+1]=r*u; pos[i*3+2]=r*s*Math.sin(th);
      const tint=tints[(Math.random()*tints.length)|0], b=0.3+Math.random()*0.7;
      col[i*3]=tint[0]*b; col[i*3+1]=tint[1]*b; col[i*3+2]=tint[2]*b;
      size[i]=sizeMin+Math.pow(Math.random(),3)*(sizeMax-sizeMin);
      ph[i]=Math.random()*Math.PI*2;
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    geo.setAttribute('aColor',new THREE.BufferAttribute(col,3));
    geo.setAttribute('aSize',new THREE.BufferAttribute(size,1));
    geo.setAttribute('aPhase',new THREE.BufferAttribute(ph,1));
    const mat=new THREE.ShaderMaterial({
      uniforms:{uTime:{value:0},uPR:{value:pixelRatio},uTwinkle:{value:reduceMotion?0:1},uBright:{value:1}},
      vertexShader:`
        attribute vec3 aColor; attribute float aSize; attribute float aPhase;
        uniform float uTime; uniform float uPR; uniform float uTwinkle; uniform float uBright;
        varying vec3 vColor;
        void main(){
          vec4 mv=modelViewMatrix*vec4(position,1.0);
          float tw=1.0+0.45*uTwinkle*sin(uTime*(0.8+fract(aPhase*7.13)*2.2)+aPhase);
          vColor=aColor*tw*uBright;
          gl_PointSize=${attenuate?'min(aSize*uPR*(120.0/-mv.z),5.0*uPR)':'aSize*uPR'};
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader:`
        varying vec3 vColor;
        void main(){
          float d=length(gl_PointCoord-0.5);
          float a=1.0-smoothstep(0.0,0.5,d);
          gl_FragColor=vec4(vColor*a*a*1.6,1.0);
        }`,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending
    });
    const pts=new THREE.Points(geo,mat);
    scene.add(pts);
    return pts;
  }
  const farStars=makeStarLayer(isMobile?2500:5000,500,1400,0.8,3.2,false);
  const nearDust=makeStarLayer(isMobile?400:900,70,260,0.6,2.2,true);   // close layer: gives parallax depth when rotating
  const starLayers=[farStars,nearDust];

  const nebulae=[];
  [0x5b3cff,0x2a7bff,0xb03cff,0x1fb6c9,0xff4d8d,0x3b5bff].forEach((c,i)=>{
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:cloudTex(1000+i*77),color:c,transparent:true,
      opacity:0.07+Math.random()*0.07,blending:THREE.AdditiveBlending,depthWrite:false}));
    const dir=new THREE.Vector3(Math.random()-0.5,(Math.random()-0.5)*0.9,Math.random()-0.5).normalize();
    s.position.copy(dir.multiplyScalar(950));
    s.scale.setScalar(700+Math.random()*500);
    scene.add(s); nebulae.push(s);
  });

  // ---------- sun ----------
  const NOISE_GLSL=`
    float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float noise(vec3 x){
      vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    float fbm(vec3 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return v; }`;
  const FRESNEL_VS=`
    varying vec3 vPos; varying vec3 vN; varying vec3 vV;
    void main(){
      vPos=position;
      vec4 wp=modelMatrix*vec4(position,1.0);
      vN=normalize(mat3(modelMatrix)*normal);
      vV=normalize(cameraPosition-wp.xyz);
      gl_Position=projectionMatrix*viewMatrix*wp;
    }`;
  const sunUniforms={uTime:{value:0}};
  const SUN_GEO=new THREE.SphereGeometry(3.2,96,64);
  const SUN_MAT=new THREE.ShaderMaterial({
    uniforms:sunUniforms,
    vertexShader:FRESNEL_VS,
    fragmentShader:`
      uniform float uTime; varying vec3 vPos; varying vec3 vN; varying vec3 vV;
      ${NOISE_GLSL}
      void main(){
        vec3 p=normalize(vPos)*2.4;
        float n=fbm(p+vec3(0.0,uTime*0.07,uTime*0.05));
        float n2=fbm(p*2.6+vec3(uTime*0.11,0.0,-uTime*0.06));
        float t=clamp(n*0.8+n2*0.45-0.1,0.0,1.0);
        vec3 col=mix(vec3(0.9,0.22,0.03),vec3(1.0,0.55,0.12),smoothstep(0.2,0.55,t));
        col=mix(col,vec3(1.0,0.92,0.62),smoothstep(0.55,0.85,t));
        float fres=pow(1.0-max(dot(normalize(vN),normalize(vV)),0.0),2.2);
        col=col*(1.0-0.35*fres)+vec3(1.0,0.45,0.12)*fres*0.9;
        gl_FragColor=vec4(col*1.25,1.0);
      }`
  });
  function glowSprite(color,opacity,scale){
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:GLOW_TEX,color,transparent:true,opacity,
      blending:THREE.AdditiveBlending,depthWrite:false}));
    s.scale.setScalar(scale); return s;
  }
  const ambientLight=new THREE.AmbientLight(0x5060a0,0.35);
  scene.add(ambientLight);

  // ---------- orbit rings (timelines) ----------
  const pulses=[];
  // rings orbit the sun, carrying their planets and date labels with them, so positions still read as dates.
  // Inner rings go round faster, like a real solar system.
  const ORBIT_PERIOD={short:120,mid:200,long:320};   // seconds per lap
  const ringPhase={short:0,mid:0,long:0};   // shared, so every system's rings turn together
  const Y_AXIS=new THREE.Vector3(0,1,0);
  const ORBIT_KEY='goalGalaxyOrbit';
  let orbitOn=!reduceMotion;
  try{ const v=localStorage.getItem(ORBIT_KEY); if(v) orbitOn=v==='on'; }catch(e){}
  let orbitK=orbitOn?1:0;   // eased speed factor: 0 = paused, 1 = full speed
  function toRingWorld(local,tf,out=new THREE.Vector3()){ return out.copy(local).applyAxisAngle(Y_AXIS,-ringPhase[tf]); }
  function fromRingWorld(world,tf){ return world.clone().applyAxisAngle(Y_AXIS,ringPhase[tf]); }
  const TRAIL_N=40;
  // one set of timeline rings for a solar system
  function buildRings(sys){
    for(const [tf,R] of Object.entries(RINGS)){
      const group=new THREE.Group();
      const arcPts=[];
      for(let i=0;i<=240;i++) arcPts.push(polar(R,i/240*ARC_END*Math.PI*2));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPts),
        new THREE.LineBasicMaterial({color:0x4652a0,transparent:true,opacity:0.6})));
      const gapPts=[];
      for(let i=0;i<=30;i++) gapPts.push(polar(R,(ARC_END+(1-ARC_END)*i/30)*Math.PI*2));
      const gap=new THREE.Line(new THREE.BufferGeometry().setFromPoints(gapPts),
        new THREE.LineDashedMaterial({color:0x7a5080,dashSize:0.35,gapSize:0.45,transparent:true,opacity:0.7}));
      gap.computeLineDistances(); group.add(gap);
      // soft band under the timeline arc (RingGeometry is in XY: rotate into the orbital plane)
      const band=new THREE.Mesh(new THREE.RingGeometry(R-0.35,R+0.35,256,1,Math.PI/2-ARC_END*Math.PI*2,ARC_END*Math.PI*2),
        new THREE.MeshBasicMaterial({color:0x2b3a8a,transparent:true,opacity:0.2,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
      band.rotation.x=-Math.PI/2; group.add(band);
      const tickPts=[];
      const addLabel=(text,th,cls)=>{
        const el=document.createElement('div'); el.className=cls; el.textContent=text;
        const o=new CSS2DObject(el); o.position.copy(polar(R+1.9,th)); group.add(o);
      };
      tickLabels(tf).forEach(t=>{
        const th=t.frac*Math.PI*2;
        tickPts.push(polar(R-0.5,th),polar(R+0.5,th));
        addLabel(t.text,th,'tick');
      });
      if(tf==='long'){ addLabel('later',LATER_FRAC*Math.PI*2,'tick gapmark'); addLabel('past',PAST_FRAC*Math.PI*2,'tick gapmark'); }
      group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts),
        new THREE.LineBasicMaterial({color:0x6070b0,transparent:true,opacity:0.75})));
      // light pulse running clockwise along the timeline = time moving forward
      const tg=new THREE.BufferGeometry();
      tg.setAttribute('position',new THREE.BufferAttribute(new Float32Array(TRAIL_N*3),3));
      tg.setAttribute('color',new THREE.BufferAttribute(new Float32Array(TRAIL_N*3),3));
      const trail=new THREE.Line(tg,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
      const head=glowSprite(0xa8b8ff,1,1.6);
      if(!reduceMotion){ group.add(trail,head); }
      pulses.push({sys,R,trail,head,period:{short:7,mid:10,long:13}[tf],offset:Math.random()});
      sys.ringGroups[tf]=group;
      sys.root.add(group);
    }
  }
  function updatePulses(t){
    for(const p of pulses){
      const k=((t/p.period)+p.offset)%1;
      const headTh=k*ARC_END*Math.PI*2;
      const fade=THREE.MathUtils.smoothstep(k,0,0.06)*(1-THREE.MathUtils.smoothstep(k,0.9,1));
      p.head.position.copy(polar(p.R,headTh));
      p.head.material.opacity=fade;
      const len=7/p.R, pos=p.trail.geometry.attributes.position, col=p.trail.geometry.attributes.color;
      for(let i=0;i<TRAIL_N;i++){
        const q=i/(TRAIL_N-1), th=Math.max(0,headTh-q*len), c=(1-q)*(1-q)*fade*0.9;
        pos.setXYZ(i,p.R*Math.sin(th),0,-p.R*Math.cos(th));
        col.setXYZ(i,0.66*c,0.72*c,1.0*c);
      }
      pos.needsUpdate=true; col.needsUpdate=true;
    }
  }

  // ---------- particles (bursts, dust, comet trails, shooting stars) ----------
  const MAX_P=isMobile?1500:3000;
  const pPos=new Float32Array(MAX_P*3), pCol=new Float32Array(MAX_P*3), pSize=new Float32Array(MAX_P), pAlpha=new Float32Array(MAX_P);
  const pVel=new Float32Array(MAX_P*3), pLife=new Float32Array(MAX_P), pMax=new Float32Array(MAX_P).fill(1), pDrag=new Float32Array(MAX_P).fill(1);
  let pCursor=0;
  const pGeo=new THREE.BufferGeometry();
  pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aColor',new THREE.BufferAttribute(pCol,3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aSize',new THREE.BufferAttribute(pSize,1).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aAlpha',new THREE.BufferAttribute(pAlpha,1).setUsage(THREE.DynamicDrawUsage));
  const pMat=new THREE.ShaderMaterial({
    uniforms:{uPR:{value:pixelRatio}},
    vertexShader:`
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      uniform float uPR; varying vec3 vColor; varying float vAlpha;
      void main(){
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        vColor=aColor; vAlpha=aAlpha;
        gl_PointSize=min(aSize*uPR*(160.0/-mv.z),48.0*uPR);
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader:`
      varying vec3 vColor; varying float vAlpha;
      void main(){
        if(vAlpha<0.01) discard;
        float d=length(gl_PointCoord-0.5);
        float a=1.0-smoothstep(0.0,0.5,d);
        gl_FragColor=vec4(vColor*a*vAlpha*1.4,1.0);
      }`,
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending
  });
  const particles=new THREE.Points(pGeo,pMat);
  particles.frustumCulled=false;
  scene.add(particles);
  let particlesDirty=false;
  function emit(p,v,color,size,life,drag=1){
    const i=pCursor; pCursor=(pCursor+1)%MAX_P;
    pPos[i*3]=p.x; pPos[i*3+1]=p.y; pPos[i*3+2]=p.z;
    pVel[i*3]=v.x; pVel[i*3+1]=v.y; pVel[i*3+2]=v.z;
    pCol[i*3]=color.r; pCol[i*3+1]=color.g; pCol[i*3+2]=color.b;
    pSize[i]=size; pLife[i]=life; pMax[i]=life; pDrag[i]=drag; pAlpha[i]=1;
    particlesDirty=true;
  }
  function updateParticles(dt){
    if(!particlesDirty) return;
    let alive=false;
    for(let i=0;i<MAX_P;i++){
      if(pLife[i]<=0){ pAlpha[i]=0; continue; }
      alive=true;
      pLife[i]-=dt;
      const k=Math.max(0,pLife[i]/pMax[i]), d=Math.pow(pDrag[i],dt*60);
      pVel[i*3]*=d; pVel[i*3+1]*=d; pVel[i*3+2]*=d;
      pPos[i*3]+=pVel[i*3]*dt; pPos[i*3+1]+=pVel[i*3+1]*dt; pPos[i*3+2]+=pVel[i*3+2]*dt;
      pAlpha[i]=k*k;
    }
    const a=pGeo.attributes;
    a.position.needsUpdate=true; a.aAlpha.needsUpdate=true; a.aColor.needsUpdate=true; a.aSize.needsUpdate=true;
    particlesDirty=alive;
  }
  const _v=new THREE.Vector3();
  function randDir(){ return _v.set(Math.random()*2-1,Math.random()*2-1,Math.random()*2-1).normalize(); }
  const SHOCK_GEO=new THREE.RingGeometry(0.9,1,96);
  const shockwaves=[];
  // an expanding ring; a t in the future delays it, size is its final radius
  function shockwave(pos,color,t,size=10,dur=1.2){
    const m=new THREE.Mesh(SHOCK_GEO,new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.9,
      blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
    m.rotation.x=-Math.PI/2; m.position.copy(pos); m.visible=false; activeScene().add(m);
    shockwaves.push({m,t0:t,dur,size});
  }
  function updateShockwaves(t){
    for(let i=shockwaves.length-1;i>=0;i--){
      const s=shockwaves[i], k=(t-s.t0)/s.dur;
      if(k<0) continue;
      if(k>=1){ s.m.removeFromParent(); s.m.material.dispose(); shockwaves.splice(i,1); continue; }
      s.m.visible=true;
      s.m.scale.setScalar(1+easeOutCubic(k)*(s.size-1));
      s.m.material.opacity=0.9*(1-k)*(1-k);
    }
  }
  function doneBurst(pos,t){
    const green=new THREE.Color(DONE_COLOR), white=new THREE.Color(1,1,1);
    const n=isMobile?90:160;
    for(let i=0;i<n;i++) emit(pos,randDir().multiplyScalar(2+Math.random()*7),Math.random()<0.3?white:green,1+Math.random()*1.4,1+Math.random()*1.2,0.96);
    if(!reduceMotion) shockwave(pos,green,t);
  }
  function dustBurst(pos,color){
    for(let i=0;i<70;i++) emit(pos,randDir().multiplyScalar(0.8+Math.random()*3),color,0.9+Math.random(),0.9+Math.random()*0.8,0.95);
  }
  const shooting=[];
  let nextShoot=performance.now()/1000+4, showerUntil=0;
  // finishing a goal sets off a few seconds of meteor shower
  function meteorShower(now){ if(!reduceMotion) showerUntil=Math.max(showerUntil,now+4.5); }
  const SHOWER_COLORS=[new THREE.Color(1,0.85,0.6),new THREE.Color(0.7,1,0.85),new THREE.Color(0.8,0.85,1)];
  function updateShooting(t,dt){
    const shower=t<showerUntil;
    if(!reduceMotion && t>=nextShoot){
      nextShoot=t+(shower? 0.08+Math.random()*0.15 : 6+Math.random()*10);
      const start=new THREE.Vector3().setFromSphericalCoords(260,0.5+Math.random()*0.8,Math.random()*Math.PI*2);
      if(shower) start.setFromSphericalCoords(240,0.35+Math.random()*0.4,1.2+Math.random()*0.8);   // they all come from one part of the sky
      const vel=new THREE.Vector3(Math.random()-0.5,-0.3-Math.random()*0.3,Math.random()-0.5).normalize().multiplyScalar(220);
      if(shower) vel.set(-0.6+Math.random()*0.15,-0.55,0.55+Math.random()*0.15).normalize().multiplyScalar(260);
      shooting.push({pos:start,vel,t0:t,dur:0.9,c:shower? SHOWER_COLORS[(Math.random()*3)|0] : null});
    }
    const c=new THREE.Color(0.8,0.88,1), zero=new THREE.Vector3();
    for(let i=shooting.length-1;i>=0;i--){
      const s=shooting[i];
      if(t-s.t0>s.dur){ shooting.splice(i,1); continue; }
      for(let j=0;j<3;j++){ s.pos.addScaledVector(s.vel,dt/3); emit(s.pos,zero,s.c||c,6,0.45); }
    }
  }

  // ---------- the sky follows your day and the seasons ----------
  // Morning is warm, midday bright, evening amber, night deep blue; the nebulae take on the season's colours.
  const SEASON_COLORS=[[0x6fb7ff,0x9fe0ff,0x7a8cff],[0x6dffb0,0xff8ad8,0x9dff6d],[0xffb648,0xff5d8d,0xffe06d],[0xff7a2f,0xb03cff,0xffa04d]];
  const SEASON=[0,0,1,1,1,2,2,2,3,3,3,0][new Date().getMonth()];   // winter, spring, summer, autumn (northern)
  const CLEAR_NIGHT=new THREE.Color(0x04050d), CLEAR_DAY=new THREE.Color(0x080b1c), CLEAR_DAWN=new THREE.Color(0x1a0d1c), CLEAR_DUSK=new THREE.Color(0x120a24);
  function applyDaylight(){
    const d=new Date(), h=d.getHours()+d.getMinutes()/60;
    const day=0.5-0.5*Math.cos(h/24*Math.PI*2);   // 0 at midnight, 1 at noon
    const dawn=Math.exp(-Math.pow((h-6.5)/1.3,2)), dusk=Math.exp(-Math.pow((h-19)/1.4,2));
    ambientLight.color.setRGB(0.26+0.1*day+0.3*dawn+0.25*dusk,0.3+0.1*day+0.1*dawn+0.05*dusk,0.58+0.08*day-0.2*dusk);
    ambientLight.intensity=0.28+0.14*day;
    starLayers.forEach(s=>s.material.uniforms.uBright.value=1.15-0.35*day);
    const clear=CLEAR_NIGHT.clone().lerp(CLEAR_DAY,day).lerp(dawn>dusk? CLEAR_DAWN : CLEAR_DUSK,Math.max(dawn,dusk)*0.85);
    renderer.setClearColor(clear,1);
  }

  // ---------- sound (off until you turn it on in ☰ More) ----------
  // Everything is synthesised: a soft ambient pad, and small sounds for things that happen.
  const SOUND_KEY='goalGalaxySound';
  const sound=(()=>{
    let ctx=null, master=null, ambient=null, on=false;
    try{ on=localStorage.getItem(SOUND_KEY)==='on'; }catch(e){}
    const PENTA=[0,2,4,7,9,12,14,16,19,21,24];
    const hz=semi=>220*Math.pow(2,semi/12);
    function ensure(){
      if(ctx) return true;
      const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return false;
      ctx=new AC(); master=ctx.createGain(); master.gain.value=0.7; master.connect(ctx.destination);
      return true;
    }
    function startAmbient(){
      if(ambient || !ctx) return;
      const g=ctx.createGain(); g.gain.value=0; g.connect(master);
      g.gain.linearRampToValueAtTime(0.06,ctx.currentTime+3);
      const filt=ctx.createBiquadFilter(); filt.type='lowpass'; filt.frequency.value=600; filt.Q.value=0.7; filt.connect(g);
      const nodes=[55,82.41,110,164.81].map((f,i)=>{
        const o=ctx.createOscillator(); o.type=i%2?'triangle':'sine'; o.frequency.value=f; o.detune.value=(i-1.5)*6;
        const og=ctx.createGain(); og.gain.value=i<2?0.5:0.2; o.connect(og); og.connect(filt); o.start(); return o;
      });
      const lfo=ctx.createOscillator(); lfo.frequency.value=0.05;
      const lg=ctx.createGain(); lg.gain.value=320; lfo.connect(lg); lg.connect(filt.frequency); lfo.start();
      // a faint cosmic wind
      const buf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate), data=buf.getChannelData(0);
      for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
      const noise=ctx.createBufferSource(); noise.buffer=buf; noise.loop=true;
      const nf=ctx.createBiquadFilter(); nf.type='bandpass'; nf.frequency.value=420; nf.Q.value=0.6;
      const ng=ctx.createGain(); ng.gain.value=0.035; noise.connect(nf); nf.connect(ng); ng.connect(g); noise.start();
      ambient={g,nodes:[...nodes,lfo,noise]};
    }
    function stopAmbient(){
      if(!ambient) return;
      const a=ambient; ambient=null;
      a.g.gain.cancelScheduledValues(ctx.currentTime); a.g.gain.linearRampToValueAtTime(0,ctx.currentTime+0.8);
      setTimeout(()=>a.nodes.forEach(n=>{ try{ n.stop(); }catch(e){} }),1000);
    }
    function tone(freq,dur,type='sine',vol=0.15,delay=0){
      if(!on || !ctx || ctx.state!=='running') return;
      const t0=ctx.currentTime+delay, o=ctx.createOscillator(), g=ctx.createGain();
      o.type=type; o.frequency.value=freq;
      g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(vol,t0+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0+dur+0.05);
    }
    return {
      get on(){ return on; },
      set(v){
        on=v;
        try{ localStorage.setItem(SOUND_KEY,v?'on':'off'); }catch(e){}
        if(v){ if(ensure()){ ctx.resume(); startAmbient(); } }
        else stopAmbient();
      },
      // browsers only allow audio after a tap or click
      wake(){ if(on && ensure()){ if(ctx.state==='suspended') ctx.resume(); startAmbient(); } },
      close(){ stopAmbient(); if(ctx) ctx.close(); ctx=null; },
      note(i,vol=0.1){ const s=PENTA[i%PENTA.length]; tone(hz(s+12),1.4,'sine',vol); tone(hz(s+24),0.9,'sine',vol*0.35,0.02); },
      chime(){ [0,4,7,12].forEach((s,i)=>tone(hz(s+12),1.8,'sine',0.09,i*0.09)); },
      rumble(v=1){ tone(46,1.6,'sine',0.25*v); tone(69,1.2,'triangle',0.07*v,0.05); },
      boom(){ tone(34,3.2,'sine',0.4); tone(52,2.4,'triangle',0.14); [12,19,24].forEach((s,i)=>tone(hz(s),2.6,'sine',0.05,0.3+i*0.15)); },
      ping(){ tone(hz(19),0.5,'sine',0.12); tone(hz(24),0.6,'sine',0.1,0.12); },
      sparkle(){ [24,28,31,36].forEach((s,i)=>tone(hz(s),0.6,'sine',0.06,i*0.06)); },
    };
  })();
  addEventListener('pointerdown',()=>sound.wake(),{signal});
  // the galaxy's own melody: now and then a planet in view rings a note from its ring and importance
  let melodyNext=0;
  function stepMelody(t){
    if(!sound.on || t<melodyNext || document.hidden) return;
    melodyNext=t+2.8+Math.random()*3.5;
    const host=view==='galaxy'? (visitSys||me) : null; if(!host) return;
    const list=[...planets.values()].filter(p=>p.sys===host && !p.dying && !p.bh);
    if(!list.length) return;
    const p=list[(Math.random()*list.length)|0];
    const base={short:4,mid:2,long:0}[p.tf]||0, imp={high:4,medium:2,low:0}[p.importance]||0;
    sound.note(base+imp,p.status==='done'?0.09:0.06);
    p.pingT=t;
  }

  // ---------- easing ----------
  const clamp01=x=>Math.min(1,Math.max(0,x));
  const easeOutCubic=x=>1-Math.pow(1-x,3);
  const easeInCubic=x=>x*x*x;
  const easeInOutCubic=x=>x<0.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
  const easeOutBack=x=>{ const c1=1.70158,c3=c1+1; return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2); };
  const easeInBack=x=>{ const c1=1.70158,c3=c1+1; return c3*x*x*x-c1*x*x; };

  // ---------- planets (goals) ----------
  const SPHERE=new THREE.SphereGeometry(1,48,32);
  const DONE_RING_GEO=new THREE.RingGeometry(1.5,2.2,96);
  const HIT_MAT=new THREE.MeshBasicMaterial({visible:false});
  const ATMO_FS=`
    uniform vec3 uColor; uniform float uIntensity; varying vec3 vN; varying vec3 vV;
    void main(){
      float f=pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.4);
      gl_FragColor=vec4(uColor*f*uIntensity,1.0);
    }`;
  const STEP_GEO=new THREE.SphereGeometry(1,16,12);
  const BLACK=new THREE.Color(0,0,0);
  const _bh1=new THREE.Vector3(), _bh2=new THREE.Vector3();
  // each person gets a steady colour from their id (guestbook comets, footprints, visitors)
  const personColor=id=>new THREE.Color().setHSL((hashStr(String(id))%360)/360,0.75,0.68);
  const CAPSULE_TEX=canvasTex(64,(g,s)=>{
    const gr=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    gr.addColorStop(0,'rgba(255,255,255,.9)'); gr.addColorStop(0.35,'rgba(255,255,255,.3)'); gr.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle=gr; g.fillRect(0,0,s,s);
    g.fillStyle='rgba(255,255,255,1)'; g.beginPath(); g.ellipse(s/2,s/2,7,13,Math.PI/5,0,Math.PI*2); g.fill();
  });
  // the black hole at the edge of each solar system, where "not done" goals go
  const BH_POS=new THREE.Vector3(-26,-1.5,23);
  const planets=new Map();   // live planets by goal id
  const dying=[];
  const hitMeshes=[];
  const camDown=new THREE.Vector3(), camRight=new THREE.Vector3();
  const SUN_END=new THREE.Color(1,0.6,0.3).multiplyScalar(0.12);

  class Planet{
    constructor(g,sys){
      this.id=g.id; this.sys=sys;
      this.group=new THREE.Group(); sys.root.add(this.group);
      this.mat=new THREE.MeshStandardMaterial({roughness:0.7,metalness:0});
      this.mesh=new THREE.Mesh(SPHERE,this.mat); this.mesh.rotation.z=0.25; this.group.add(this.mesh);
      this.atmoMat=new THREE.ShaderMaterial({uniforms:{uColor:{value:new THREE.Color()},uIntensity:{value:1.2}},
        vertexShader:FRESNEL_VS,fragmentShader:ATMO_FS,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});
      this.atmo=new THREE.Mesh(SPHERE,this.atmoMat); this.group.add(this.atmo);
      this.ring=new THREE.Mesh(DONE_RING_GEO,new THREE.MeshBasicMaterial({color:DONE_COLOR,transparent:true,opacity:0.55,
        side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));
      this.ring.rotation.x=-Math.PI/2+0.5; this.group.add(this.ring);
      this.warn=new THREE.Sprite(new THREE.SpriteMaterial({map:RING_TEX,color:0xff4d4d,transparent:true,
        blending:THREE.AdditiveBlending,depthWrite:false}));
      this.group.add(this.warn);
      this.hit=new THREE.Mesh(SPHERE,HIT_MAT); this.hit.userData.id=g.id; this.group.add(this.hit);
      hitMeshes.push(this.hit);
      const lg=new THREE.BufferGeometry();
      lg.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
      lg.setAttribute('color',new THREE.BufferAttribute(new Float32Array(6),3));
      this.link=new THREE.Line(lg,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:0.6,
        blending:THREE.AdditiveBlending,depthWrite:false}));
      sys.root.add(this.link);
      this.labelEl=document.createElement('div'); this.labelEl.className='plabel';
      this.label=new CSS2DObject(this.labelEl); this.label.center.set(0.5,0); this.group.add(this.label);
      this.phase=Math.random()*Math.PI*2; this.spin=0.15+Math.random()*0.25;
      this.pos=new THREE.Vector3(); this.target=new THREE.Vector3();
      this.move=null; this.scaleAnim={from:0,to:0,t0:0,dur:1,ease:easeOutBack};
      this.hoverK=1; this.hoverTarget=1; this.curScale=0; this.labelOpacity=-1;
      this.texKey=null; this.status=null; this.radius=1; this.dying=false;
      // moons (steps), guestbook comets and the time capsule circle the planet
      this.moons=[]; this.comets=[]; this.capsule=null; this.capsuleState='none';
      // a goal marked "not done" spirals into its system's black hole (bhK: 0 on its ring -> 1 inside)
      this.bh=false; this.bhSlot=0; this.bhT0=-99; this.bhFrom=new THREE.Vector3();
    }
    // moons for steps, comets for guestbook notes, a capsule for a letter to the future
    syncExtras(g,now){
      const col=new THREE.Color(COLORS[g.importance]);
      const steps=(g.steps||[]).filter(x=>!x.pending);
      while(this.moons.length>steps.length){ const m=this.moons.pop(); this.group.remove(m.mesh); m.mat.dispose(); }
      while(this.moons.length<steps.length){
        const mat=new THREE.MeshStandardMaterial({roughness:0.55,metalness:0});
        const mesh=new THREE.Mesh(STEP_GEO,mat); this.group.add(mesh);
        this.moons.push({mesh,mat,phase:Math.random()*Math.PI*2,tilt:(Math.random()-0.5)*1.2,done:null,born:now});
      }
      steps.forEach((st,i)=>{
        const m=this.moons[i];
        // a step just ticked off: the moon lights up with a small burst
        if(m.done===false && st.done && this.sys.root.visible){ m.flash=now; sound.note(i); }
        m.done=st.done;
        m.mat.color.set(st.done? 0xffffff : 0x4d536c);
        m.mat.emissive.copy(st.done? col : BLACK); m.mat.emissiveIntensity=st.done?0.9:0;
      });
      const notes=(g.guestNotes||[]).slice(0,5);
      while(this.comets.length>notes.length){ const c=this.comets.pop(); this.group.remove(c.head); c.head.material.dispose(); }
      while(this.comets.length<notes.length){
        const head=glowSprite(0xffffff,0.9,0.7); this.group.add(head);
        this.comets.push({head,phase:Math.random()*Math.PI*2,tilt:(Math.random()-0.5)*1.4,ecc:0.2+Math.random()*0.3,color:new THREE.Color()});
      }
      notes.forEach((n,i)=>{
        const c=this.comets[i];
        c.color.copy(personColor(n.author.id)); c.head.material.color.copy(c.color);
        c.unread=n.unread;
      });
      const cs=g.capsule? g.capsule.state : 'none';
      if(cs==='none' && this.capsule){ this.group.remove(this.capsule); this.capsule.material.dispose(); this.capsule=null; }
      if(cs!=='none' && !this.capsule){ this.capsule=new THREE.Sprite(new THREE.SpriteMaterial({map:CAPSULE_TEX,transparent:true,depthWrite:false})); this.group.add(this.capsule); }
      if(this.capsule) this.capsule.material.color.set(cs==='open'? 0xffd27a : 0x9fb4ff);
      if(cs==='open' && this.capsuleState==='sealed' && this.sys.root.visible) dustBurst(this.world(),new THREE.Color(0xffd27a));
      this.capsuleState=cs;
    }
    updateExtras(t,dt,R){
      const shown=this.sys.root.visible && !reduceMotion;
      this.moons.forEach((m,i)=>{
        const r=R*1.9+0.35+i*0.3, a=t*(0.9/(1+i*0.25))+m.phase;
        m.mesh.position.set(Math.cos(a)*r,Math.sin(a+m.tilt)*r*m.tilt*0.35,Math.sin(a)*r);
        const pop=m.flash && t-m.flash<0.8? 1+1.5*Math.exp(-(t-m.flash)*5) : 1;
        m.mesh.scale.setScalar(Math.max(0.0001,Math.max(0.09,R*0.15)*pop*Math.min(1,(t-m.born)*2)));
        if(m.flash && t-m.flash<0.05 && shown){ const w=this.group.position.clone().add(m.mesh.position).add(this.sys.offset); for(let j=0;j<24;j++) emit(w,randDir().multiplyScalar(1+Math.random()*2),this.mat.emissive,0.8,0.6,0.94); }
      });
      this.comets.forEach((c,i)=>{
        const r=R*3+0.6+i*0.45, a=t*(0.45/(1+i*0.2))+c.phase;
        c.head.position.set(Math.cos(a)*r,Math.sin(a*2+c.tilt)*r*0.12,Math.sin(a)*r*(1-c.ecc));
        const k=(c.unread?1.4:0.9)*(1+0.15*Math.sin(t*4+c.phase));
        c.head.scale.setScalar(Math.max(0.0001,k*Math.max(0.5,R*0.6)));
        if(shown && Math.random()<dt*(c.unread?30:14)){
          const w=this.group.position.clone().add(c.head.position).add(this.sys.offset);
          emit(w,randDir().multiplyScalar(0.15),c.color,0.8,0.5+Math.random()*0.4,0.97);
        }
      });
      if(this.capsule){
        const a=t*0.35+this.phase;
        this.capsule.position.set(Math.cos(a)*R*1.45,R*0.9+Math.sin(t*1.3)*0.12,Math.sin(a)*R*1.45);
        const glow=this.capsuleState==='open'? 1+0.25*Math.sin(t*5) : 0.8+0.2*Math.sin(t*2);
        this.capsule.scale.set(Math.max(0.0001,0.55*glow),Math.max(0.0001,0.55*glow),1);
      }
    }
    // where a goal in the black hole circles right now (system coordinates)
    bhPos(t,out){
      const r=2.8+this.bhSlot*0.85, a=t*(1.4/(1+this.bhSlot*0.35))+this.bhSlot*2.1;
      return out.set(BH_POS.x+Math.cos(a)*r,BH_POS.y+Math.sin(a)*r*0.18,BH_POS.z+Math.sin(a)*r);
    }
    apply(g,entry,mode,now,delay=0){
      const col=COLORS[g.importance], c=new THREE.Color(col);
      const done=g.status==='done', nd=g.status==='notdone';
      this.radius=PLANET_R[g.importance]; this.importance=g.importance;
      if(this.texKey!==col){
        if(this.mat.map) this.mat.map.dispose();
        this.mat.map=planetTexture(col,hashStr(g.id)); this.mat.emissiveMap=this.mat.map;
        this.texKey=col; this.mat.needsUpdate=true;
      }
      this.mat.color.set(nd?0x6a6f88:0xffffff);
      this.mat.emissive.copy(c); this.mat.emissiveIntensity=nd?0:0.22;
      if(this.mat.transparent!==nd){ this.mat.transparent=nd; this.mat.needsUpdate=true; }
      this.mat.opacity=nd?0.5:1;
      this.atmo.visible=!nd;
      this.atmoMat.uniforms.uColor.value.copy(done? new THREE.Color(DONE_COLOR).lerp(c,0.4) : c);
      this.atmoMat.uniforms.uIntensity.value=g.importance==='high'?1.6:1.1;
      this.ring.visible=done;
      this.warn.visible=isOverdue(g);
      this.hit.scale.setScalar(Math.max(this.radius*1.9,1.5));
      const lc=this.link.geometry.attributes.color, pc=c.clone().multiplyScalar(nd?0.15:0.7);
      lc.setXYZ(0,SUN_END.r,SUN_END.g,SUN_END.b); lc.setXYZ(1,pc.r,pc.g,pc.b); lc.needsUpdate=true;

      this.labelEl.textContent='';
      this.labelEl.append((done?'✓ ':'')+g.name);
      if(g.notes){ const ni=document.createElement('span'); ni.className='nicon'; ni.textContent='✎'; this.labelEl.append(ni); }
      if(g.isPrivate && this.sys.isMe){ const li=document.createElement('span'); li.className='nicon'; li.textContent='🔒'; this.labelEl.append(li); }
      if(this.warn.visible){ const tag=document.createElement('span'); tag.className='tag'; tag.textContent='overdue'; this.labelEl.append(tag); }
      if(this.warn.visible && g.why){ const w=document.createElement('span'); w.className='why'; w.textContent='why: '+(g.why.length>70? g.why.slice(0,68)+'…' : g.why); this.labelEl.append(w); }
      this.labelEl.classList.toggle('notdone',nd);

      const becameDone = mode==='update' && this.status && this.status!=='done' && done;
      this.status=g.status;
      const prevTf=this.tf;
      this.tf=g.timeframe;

      if(mode==='comet'){
        this.pos.set(0,0,0);
        this.move={type:'comet',from:new THREE.Vector3(),to:entry.pos.clone(),t0:now,dur:reduceMotion?0.01:1.8};
        this.scaleAnim={from:0.15,to:1,t0:now,dur:reduceMotion?0.01:1.8,ease:easeOutCubic};
      }else if(mode==='pop'){
        this.pos.copy(entry.pos);
        this.scaleAnim={from:0,to:1,t0:now+delay,dur:reduceMotion?0.01:0.9,ease:easeOutBack};
      }else if(prevTf!==this.tf){
        // moving to another ring: start from where it is now, expressed in the new ring's frame
        const from=fromRingWorld(toRingWorld(this.pos,prevTf),this.tf);
        this.pos.copy(from);
        this.move={type:'lerp',from,to:entry.pos.clone(),t0:now,dur:reduceMotion?0.01:1.0};
      }else if(!entry.pos.equals(this.target)){
        this.move={type:'lerp',from:this.pos.clone(),to:entry.pos.clone(),t0:now,dur:reduceMotion?0.01:1.0};
      }
      this.target.copy(entry.pos);
      if(becameDone){ doneBurst(this.world(),now); meteorShower(now); sound.chime(); }
      // into the black hole, or pulled back out to its ring
      const wasBh=this.bh;
      this.bh=nd;
      if(nd && !wasBh){ this.bhFrom.copy(this.group.position); this.bhT0= mode==='update'? now : now-99; if(mode==='update') sound.rumble(0.6); }
      if(!nd && wasBh){
        const from=fromRingWorld(this.group.position,this.tf);
        this.pos.copy(from);
        this.move={type:'lerp',from,to:entry.pos.clone(),t0:now,dur:reduceMotion?0.01:1.8};
        if(this.sys.root.visible) dustBurst(this.world(),new THREE.Color(COLORS[g.importance]));
      }
      this.link.visible=!nd;
      this.goal=g;
      this.syncExtras(g,now);
    }
    kill(now){
      this.dying=true;
      this.scaleAnim={from:this.curScale,to:0,t0:now,dur:0.7,ease:easeInBack};
      const i=hitMeshes.indexOf(this.hit); if(i>=0) hitMeshes.splice(i,1);
      dustBurst(this.world(),new THREE.Color(COLORS[this.importance]));
      this.link.visible=false;
    }
    update(t,dt){
      if(this.move){
        const m=this.move, k=clamp01((t-m.t0)/m.dur);
        if(m.type==='comet'){
          // spiral outward from the sun into its slot
          const R=Math.hypot(m.to.x,m.to.z), th=Math.atan2(m.to.x,-m.to.z), e=easeOutCubic(k);
          const r=R*e, a=th-1.6*(1-e);
          this.pos.set(r*Math.sin(a),Math.sin(k*Math.PI)*2.5,-r*Math.cos(a));
          this.cometTrail=k<1 && !reduceMotion;
        }else this.pos.lerpVectors(m.from,m.to,easeInOutCubic(k));
        if(k>=1){ this.move=null; this.cometTrail=false; }
      }else this.pos.copy(this.target);
      const bob=reduceMotion?0:Math.sin(t*0.9+this.phase)*0.12;
      toRingWorld(this.pos,this.tf,this.group.position);
      this.group.position.y+=bob;
      if(this.bh){
        // spiral in from where it was, then circle the black hole
        const P=this.bhPos(t,_bh1), k=clamp01((t-this.bhT0)/(reduceMotion?0.01:2.8));
        if(k<1){
          const e=easeInCubic(k), off=_bh2.copy(this.bhFrom).sub(BH_POS).applyAxisAngle(Y_AXIS,k*Math.PI*1.8).multiplyScalar(1-e);
          this.group.position.copy(BH_POS).add(off).addScaledVector(_bh1.sub(BH_POS),e);
          if(this.sys.root.visible && Math.random()<0.6) emit(this.world(),randDir().multiplyScalar(0.3),new THREE.Color(0.55,0.5,0.7),1,0.7,0.96);
        }else this.group.position.copy(P);
      }
      if(this.cometTrail){
        const c=new THREE.Color(COLORS[this.importance]).lerp(new THREE.Color(1,1,1),0.3);
        const w=this.world();
        for(let j=0;j<2;j++) emit(w,randDir().multiplyScalar(0.3),c,1.2,0.6+Math.random()*0.4,0.97);
      }

      const sa=this.scaleAnim, sk=clamp01((t-sa.t0)/sa.dur);
      this.curScale=Math.max(0,sa.from+(sa.to-sa.from)*sa.ease(sk));
      this.hoverK+=(this.hoverTarget-this.hoverK)*Math.min(1,dt*10);
      const ping=this.pingT? 1+0.25*Math.exp(-(t-this.pingT)*4) : 1;
      const R=this.radius*this.curScale*this.hoverK*(this.bh?0.6:1)*ping;
      this.mesh.scale.setScalar(Math.max(R,0.0001));
      this.atmo.scale.setScalar(Math.max(R*1.22,0.0001));
      this.ring.scale.setScalar(Math.max(R,0.0001));
      this.mesh.rotation.y+=dt*this.spin;
      if(this.warn.visible){
        const p=0.5+0.5*Math.sin(t*3.5+this.phase);
        this.warn.scale.setScalar(Math.max(R,0.0001)*(3+p*0.9));
        this.warn.material.opacity=0.35+0.5*(1-p);
      }
      this.label.position.copy(camDown).multiplyScalar(R+0.35);
      this.updateExtras(t,dt,R);
      const lo=(this.dying||this.curScale<0.3)?0:1;
      if(lo!==this.labelOpacity){ this.labelEl.style.opacity=lo; this.labelOpacity=lo; }
      const lp=this.link.geometry.attributes.position;
      lp.setXYZ(1,this.group.position.x,this.group.position.y,this.group.position.z); lp.needsUpdate=true;
      if(this.dying && sk>=1){ this.dispose(); return false; }
      return true;
    }
    // position in the scene (the planet's group is local to its solar system)
    world(out=new THREE.Vector3()){ return out.copy(this.group.position).add(this.sys.offset); }
    dispose(){
      this.sys.root.remove(this.group); this.sys.root.remove(this.link);
      this.labelEl.remove();
      if(this.mat.map) this.mat.map.dispose();
      this.mat.dispose(); this.atmoMat.dispose(); this.ring.material.dispose(); this.warn.material.dispose();
      this.moons.forEach(m=>m.mat.dispose()); this.comets.forEach(c=>c.head.material.dispose());
      if(this.capsule) this.capsule.material.dispose();
      this.link.geometry.dispose(); this.link.material.dispose();
    }
  }

  const clockNow=()=>performance.now()/1000;
  // bring the 3D scene in line with the goals array
  //   'initial' / 'reload': new planets pop in (staggered);  'user': new planets fly out of the sun as comets
  function syncScene(mode,sys=me){
    const list=sysGoals(sys);
    const now=clockNow(), layout=computeLayout(list), ids=new Set(list.map(g=>g.id));
    for(const [id,p] of planets){
      if(p.sys!==sys) continue;
      if(!ids.has(id)){ p.kill(now); planets.delete(id); dying.push(p); if(hoveredId===id) hoveredId=null; }
    }
    let n=0;
    list.forEach(g=>{
      const entry=layout.get(g.id);
      let p=planets.get(g.id);
      if(!p){
        p=new Planet(g,sys); planets.set(g.id,p);
        p.apply(g,entry,mode==='user'?'comet':'pop',now,(n++)*0.07);
      }else p.apply(g,entry,'update',now);
    });
    let k=0;
    for(const g of list) if(g.status==='notdone') planets.get(g.id).bhSlot=k++;
    sys.blackHole.count=k;
    syncLinks(sys,list);
  }

  // ---------- links between goals: a curved line of light flowing from one planet into the other ----------
  const LINK_N=40;
  const links=new Map();   // "fromId>toId" -> link
  function syncLinks(sys,list){
    const want=new Set();
    for(const g of list) for(const to of g.links||[]){
      const a=planets.get(g.id), b=planets.get(to);
      if(!a || !b || a.sys!==sys || b.sys!==sys) continue;
      const key=g.id+'>'+to; want.add(key);
      if(links.has(key)) continue;
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(LINK_N*3),3));
      geo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(LINK_N*3),3));
      const line=new THREE.Line(geo,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
      line.frustumCulled=false;
      sys.root.add(line);
      links.set(key,{key,sys,a,b,line,born:clockNow()});
    }
    for(const [key,l] of links) if(l.sys===sys && !want.has(key)) removeLink(key);
  }
  function removeLink(key){
    const l=links.get(key); if(!l) return;
    l.line.removeFromParent(); l.line.geometry.dispose(); l.line.material.dispose();
    links.delete(key);
  }
  function updateLinks(t){
    for(const l of links.values()){
      if(!l.sys.root.visible) continue;
      if(l.a.dying || l.b.dying || !planets.has(l.a.id) || !planets.has(l.b.id)){ removeLink(l.key); continue; }
      const A=l.a.group.position, B=l.b.group.position;
      const len=A.distanceTo(B), grow=Math.min(1,(t-l.born)*1.5);
      const ca=new THREE.Color(COLORS[l.a.importance]), cb=new THREE.Color(COLORS[l.b.importance]);
      const pos=l.line.geometry.attributes.position, col=l.line.geometry.attributes.color;
      for(let i=0;i<LINK_N;i++){
        const u=i/(LINK_N-1)*grow, v=1-u, h=Math.sin(u*Math.PI)*len*0.22;
        pos.setXYZ(i,v*A.x+u*B.x,v*A.y+u*B.y+h,v*A.z+u*B.z);
        // bright pulses run from the goal that feeds into the other
        const br=0.25+0.75*Math.pow(0.5+0.5*Math.sin(u*len*0.8-t*4),8);
        col.setXYZ(i,(ca.r+(cb.r-ca.r)*u)*br,(ca.g+(cb.g-ca.g)*u)*br,(ca.b+(cb.b-ca.b)*u)*br);
      }
      pos.needsUpdate=true; col.needsUpdate=true;
    }
  }

  // ---------- solar systems: yours, and one per connection that you visit through a sun-gate ----------
  // A system is a group holding a sun, its rings and its planets. Every system sits at the centre, but
  // only one is shown: yours at home, or the connection's you're visiting.
  const systems=new Map();   // 'me' | connected user's id -> system
  const SUN_LIGHT_RANGE=70;  // each sun only lights its own planets
  // everything that belongs to your home galaxy only (gates, multiverse portals, threads, constellation)
  const homeLayer=new THREE.Group();
  scene.add(homeLayer);
  let visitSys=null;   // the connection's system you're visiting, or null at home
  function makeSystem(key,name,isMe){
    const sys={key,name,isMe,goals:isMe?null:[],connectionId:null,ringGroups:{},
      root:new THREE.Group(),offset:new THREE.Vector3(),targetOffset:new THREE.Vector3()};
    sys.sun=new THREE.Mesh(SUN_GEO,SUN_MAT);
    sys.coronaInner=glowSprite(0xffb050,0.55,13); sys.coronaOuter=glowSprite(0xff7a2f,0.14,28);
    sys.root.add(sys.sun,sys.coronaInner,sys.coronaOuter,new THREE.PointLight(0xffe2b8,3.0,SUN_LIGHT_RANGE,0));
    sys.labelEl=document.createElement('div'); sys.labelEl.className=isMe?'sunlbl':'sunlbl friend';
    sys.labelEl.textContent=isMe?'You':name;
    sys.label=new CSS2DObject(sys.labelEl); sys.root.add(sys.label);
    sys.hit=new THREE.Mesh(SPHERE,HIT_MAT); sys.hit.scale.setScalar(4.5); sys.hit.userData.sys=key;
    sys.root.add(sys.hit); hitMeshes.push(sys.hit);
    buildRings(sys);
    sys.blackHole=makeBlackHole(sys);
    sys.root.visible=isMe;
    scene.add(sys.root);
    systems.set(key,sys);
    return sys;
  }
  function sysGoals(sys){ return sys.isMe? goals : sys.goals; }
  function destroySystem(sys){
    if(visitSys===sys){ restoreHome(); flyHome(0.01); showToast(`You're no longer connected with ${sys.name}.`); }
    for(const [id,p] of planets) if(p.sys===sys){ const i=hitMeshes.indexOf(p.hit); if(i>=0) hitMeshes.splice(i,1); p.dispose(); planets.delete(id); if(hoveredId===id) hoveredId=null; }
    for(let i=dying.length-1;i>=0;i--) if(dying[i].sys===sys){ dying[i].dispose(); dying.splice(i,1); }
    for(let i=pulses.length-1;i>=0;i--) if(pulses[i].sys===sys) pulses.splice(i,1);
    const hi=hitMeshes.indexOf(sys.hit); if(hi>=0) hitMeshes.splice(hi,1);
    const shared=new Set([SUN_GEO,SPHERE,DONE_RING_GEO,SUN_MAT,HIT_MAT,GLOW_TEX]);
    sys.root.traverse(o=>{
      if(o.isCSS2DObject) o.element.remove();   // CSS2D labels leave the DOM only when removed directly
      if(o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
      if(o.material && !shared.has(o.material)) o.material.dispose();
    });
    scene.remove(sys.root);
    systems.delete(sys.key);
    destroyGate(sys.key);
    if(detailSys===sys && detailOverlay.classList.contains('show')) closeDetail(false);
  }

  // ---------- black holes ----------
  const BH_VS=`varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const BH_FS=`
    uniform float uTime; varying vec3 vPos;
    void main(){
      float r=length(vPos.xy), a=atan(vPos.y,vPos.x);
      float t=clamp((r-1.7)/3.8,0.0,1.0);   // 0 at the inner edge, 1 at the outer
      float swirl=0.5+0.5*sin(a*3.0-uTime*2.2+r*3.5);
      float fine=0.5+0.5*sin(a*13.0-uTime*4.5+r*9.0);
      vec3 hot=mix(vec3(1.0,0.93,0.78),vec3(0.95,0.35,0.08),t);
      float alpha=smoothstep(0.0,0.08,t)*(1.0-smoothstep(0.55,1.0,t));
      gl_FragColor=vec4(hot*(0.35+0.65*swirl)*(0.7+0.3*fine)*(1.3-t)*alpha,alpha);
    }`;
  const BH_DISK_GEO=new THREE.RingGeometry(1.7,5.5,96,1);
  const BH_CORE_MAT=new THREE.MeshBasicMaterial({color:0x000000});
  function makeBlackHole(sys){
    const bh={group:new THREE.Group(),count:0,shown:0};
    bh.mat=new THREE.ShaderMaterial({uniforms:{uTime:{value:0}},vertexShader:BH_VS,fragmentShader:BH_FS,
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
    bh.disk=new THREE.Mesh(BH_DISK_GEO,bh.mat); bh.disk.rotation.x=-Math.PI/2+0.35;
    bh.core=new THREE.Mesh(SPHERE,BH_CORE_MAT); bh.core.scale.setScalar(1.35);
    bh.halo=glowSprite(0xff9a50,0.5,8);
    bh.labelEl=el('div','bhlbl'); bh.label=new CSS2DObject(bh.labelEl); bh.label.center.set(0.5,0);
    bh.group.add(bh.halo,bh.disk,bh.core,bh.label);
    bh.group.position.copy(BH_POS);
    sys.root.add(bh.group);
    return bh;
  }
  function updateBlackHoles(t,dt){
    for(const s of systems.values()){
      const bh=s.blackHole, want=bh.count>0?1:0;
      bh.shown+=(want-bh.shown)*Math.min(1,dt*2);
      bh.group.visible=bh.shown>0.01;
      if(!bh.group.visible || !s.root.visible) continue;
      bh.mat.uniforms.uTime.value=t;
      bh.group.scale.setScalar(Math.max(0.0001,bh.shown));
      bh.halo.material.opacity=0.45+0.1*Math.sin(t*1.7);
      bh.label.position.copy(camDown).multiplyScalar(6.4);
      bh.labelEl.textContent=bh.count? `black hole · ${bh.count} not done` : '';
      // dust drifting in
      if(!reduceMotion && Math.random()<dt*8){
        const d=randDir().clone(); d.y*=0.2; const r=6+Math.random()*3;
        emit(_bh1.copy(BH_POS).addScaledVector(d,r).add(s.offset),d.multiplyScalar(-r/1.4),new THREE.Color(1,0.6,0.3),0.8,1.4,1);
      }
    }
  }

  // ---------- rifts: a tear through space into each connection's pocket universe ----------
  // A tall ragged slit with burning edges. Through it you glimpse another sky and your friend's sun;
  // light leaks out around it, and it opens wider when you hover it.
  const GATE_R=44;   // just outside your outer ring
  const GATE_VS=`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const GATE_FS=`
    uniform float uTime; uniform vec3 uColor; uniform float uHover; uniform float uSeed; uniform float uLife; varying vec2 vUv;
    float h1(float n){ return fract(sin(n)*43758.5453); }
    float n1(float x){ float i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f); return mix(h1(i),h1(i+1.0),f); }
    float h2(vec2 q){ return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453); }
    void main(){
      vec2 p=vUv*2.0-1.0;   // x across the tear, y along it
      float y=p.y;
      // how far the tear is open: widest in the middle, closing to points at the ends, breathing slowly
      // uLife: 1 when they've been active lately, lower the longer they've been away (the tear narrows and dims)
      float open=0.3*(1.0+0.4*uHover)*(1.0+0.07*sin(uTime*1.3+uSeed))*(0.7+0.3*uLife);
      float w=open*pow(max(1.0-y*y,0.0),0.85);
      // ragged, shifting edges; the whole tear wanders a little
      float jag=(n1(y*9.0+uSeed+uTime*0.6)-0.5)*0.09+(n1(y*27.0-uTime*1.3+uSeed*3.0)-0.5)*0.045;
      float cx=p.x-(n1(y*2.3+uSeed)-0.5)*0.14;
      float d=abs(cx+jag*0.4)-(w+jag*w*3.0);   // < 0 inside the tear
      vec3 col=vec3(0.0); float a=0.0;
      if(d<0.0){
        // the other universe: deep violet space, drifting stars, their sun far away
        vec2 q=vec2(cx*3.0,y)*9.0+vec2(0.0,uTime*0.25);
        vec2 cell=floor(q);
        float star=step(0.9,h2(cell+uSeed))*smoothstep(0.32,0.0,length(fract(q)-0.5));
        float neb=n1(y*3.0+uTime*0.15+uSeed)*0.6;
        vec3 deep=mix(vec3(0.02,0.01,0.07),vec3(0.14,0.05,0.22),neb);
        float sun=exp(-length(vec2(cx*3.0,y*1.4))*7.0);
        float edge=exp(d*18.0);
        col=deep+vec3(0.9,0.92,1.0)*star+vec3(1.0,0.62,0.25)*sun*2.2+uColor*edge*0.9;
        a=0.97;
      }
      // the burning edge
      float rim=exp(-abs(d)*55.0)*step(abs(y),0.995);
      float flick=0.75+0.25*sin(uTime*8.0+y*23.0+uSeed);
      rim*=0.35+0.65*uLife;
      col+=(uColor*1.8+vec3(0.5))*rim*flick;
      a=max(a,rim);
      // light spilling out into space, strongest around the middle
      float leak=exp(-max(d,0.0)*8.0)*pow(1.0-abs(y),1.5)*0.4*(1.0+0.7*uHover)*(0.3+0.7*uLife);
      col+=uColor*leak;
      a=max(a,leak);
      // hairline cracks running on from both tips
      float tip=smoothstep(0.7,0.97,abs(y));
      float crack=exp(-abs(p.x-(n1(y*16.0+uSeed*5.0)-0.5)*0.3*tip)*70.0)*tip*(1.0-smoothstep(0.97,1.0,abs(y)));
      col+=uColor*crack*0.9;
      a=max(a,crack*0.8);
      if(a<0.01) discard;
      gl_FragColor=vec4(col,a);
    }`;
  const GATE_GEO=new THREE.PlaneGeometry(1,1);
  const _zAxis=new THREE.Vector3(0,0,1);
  const gates=new Map();   // connection's user id -> gate
  function makeGate(key,color,parent,userData){
    const seed=(hashStr(key)%1000)/37;
    const g={key,group:new THREE.Group(),hoverK:0,hoverShown:0,phase:Math.random()*6,base:new THREE.Vector3(),
      // each rift leans its own way
      tilt:new THREE.Quaternion().setFromAxisAngle(_zAxis,((hashStr(key+'t')%100)/100-0.5)*0.5)};
    g.mat=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uColor:{value:new THREE.Color(color)},uHover:{value:0},uSeed:{value:seed},uLife:{value:1}},
      vertexShader:GATE_VS,fragmentShader:GATE_FS,transparent:true,depthWrite:false,side:THREE.DoubleSide});
    g.disc=new THREE.Mesh(GATE_GEO,g.mat);
    g.glow=glowSprite(color,0.3,7);
    g.hit=new THREE.Mesh(SPHERE,HIT_MAT); g.hit.scale.set(2.6,4.8,2.6); Object.assign(g.hit.userData,userData);
    g.labelEl=el('div','gatelbl'); g.label=new CSS2DObject(g.labelEl); g.label.center.set(0.5,0);
    g.group.add(g.glow,g.disc,g.hit,g.label);
    parent.add(g.group);
    hitMeshes.push(g.hit);
    return g;
  }
  function disposeGate(g){
    const i=hitMeshes.indexOf(g.hit); if(i>=0) hitMeshes.splice(i,1);
    g.labelEl.remove(); g.group.removeFromParent();
    g.mat.dispose(); g.glow.material.dispose();
  }
  function destroyGate(key){ const g=gates.get(key); if(g){ disposeGate(g); gates.delete(key); } }
  // how alive a connection's rift looks: 1 if they were around in the last day, fading over a month
  function riftLife(f){
    if(!f || !f.lastSeenAt) return 0.35;
    const days=(Date.now()-new Date(f.lastSeenAt).getTime())/86400000;
    return days<1? 1 : Math.max(0.25,1-Math.log10(days)*0.55);
  }
  function awayText(f){
    if(!f || !f.lastSeenAt) return 'not seen yet';
    const m=(Date.now()-new Date(f.lastSeenAt).getTime())/60000;
    if(m<10) return 'active now';
    if(m<60*24) return 'active today';
    const d=Math.round(m/60/24);
    return d<14? `away ${d} day${d===1?'':'s'}` : `away ${Math.round(d/7)} weeks`;
  }
  function labelGate(sys){
    const g=gates.get(sys.key); if(!g) return;
    const f=sys.friend, n=sys.goals.length, done=sys.goals.filter(x=>x.status==='done').length;
    const home=(sysPresence.get(sys.key)||new Map()).has(sys.key);
    g.labelEl.textContent=sys.name;
    const bits=[n? `${n} goal${n===1?'':'s'} · ${done} done` : 'no shared goals yet', home? '● home now' : awayText(f)];
    if(f && f.mentorsMe) bits.push('🎓 your mentor');
    if(f && f.iMentor) bits.push('you mentor them');
    g.labelEl.append(el('span','sub',bits.join(' · ')));
    if(f && f.visitedMeAt) g.labelEl.append(el('span','sub foot','👣 visited you '+relAgo(f.visitedMeAt)));
    g.mat.uniforms.uLife.value= home? 1 : riftLife(f);
    g.visited=!!(f && f.visitedMeAt);
  }
  // the way home, shown inside a connection's system
  const homeGate=makeGate('home','#9fc2ff',scene,{home:true});
  homeGate.base.set(RINGS.long+9,3,RINGS.long*0.25);
  homeGate.labelEl.textContent='⌂ Home'; homeGate.labelEl.append(el('span','sub','back to your galaxy'));
  homeGate.group.visible=false;
  const gatePos=key=>{ const g=gates.get(key); return g? g.group.position : me.offset; };
  // faint lines from your sun to each gate
  const sunLinks=new THREE.LineSegments(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({color:0x8a7348,transparent:true,opacity:0.3,blending:THREE.AdditiveBlending,depthWrite:false}));
  sunLinks.frustumCulled=false;
  homeLayer.add(sunLinks);
  // Rifts go round your system in a circle. People you've put in a group sit together as a cluster,
  // under a nebula in the group's colour that glows brighter the more of their goals are done.
  const clusters=new Map();   // group id -> cluster visuals
  const RIFT_GOLD=new THREE.Color('#ffb84d');
  function layoutSystems(){
    const friends=[...systems.values()].filter(s=>!s.isMe);
    for(const key of [...gates.keys()]) if(!systems.has(key)) destroyGate(key);
    const groups=(social && social.groups)||[];
    const units=[];
    for(const gr of groups){ const m=friends.filter(s=>s.friend && s.friend.groupId===gr.id); if(m.length) units.push({group:gr,members:m}); }
    for(const s of friends) if(!units.some(u=>u.members.includes(s))) units.push({group:null,members:[s]});
    const STEP=0.24, GAP=0.45, TAU=Math.PI*2;
    const need=units.reduce((a,u)=>a+(u.members.length-1)*STEP+GAP,0);
    const squeeze=need>TAU? TAU/need : 1, spare=need<TAU? (TAU-need)/Math.max(1,units.length) : 0;
    let a=Math.PI*0.25;
    for(const u of units){
      const span=(u.members.length-1)*STEP*squeeze, slot=span+GAP*squeeze+spare;
      u.angle=a+slot/2; u.span=span;
      u.members.forEach((s,i)=>{
        if(!gates.has(s.key)) gates.set(s.key,makeGate(s.key,'#ffb84d',homeLayer,{gate:s.key}));
        const g=gates.get(s.key), ang=u.angle-span/2+i*STEP*squeeze;
        g.base.set(GATE_R*Math.sin(ang),3,-GATE_R*Math.cos(ang));
        g.mat.uniforms.uColor.value.copy(RIFT_GOLD).lerp(new THREE.Color(u.group? u.group.color : '#ffb84d'),u.group?0.55:0);
        labelGate(s);
      });
      a+=slot;
    }
    syncClusters(units.filter(u=>u.group));
    controls.maxDistance=320;
    sunLinks.geometry.dispose();
    sunLinks.geometry=new THREE.BufferGeometry();
    sunLinks.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(friends.length*6),3));
    updateAllBtn();
  }
  function updateAllBtn(){ $('allBtn').style.display=(gates.size || portals.size)?'':'none'; }
  function syncClusters(units){
    const keep=new Set(units.map(u=>u.group.id));
    for(const [id,c] of clusters) if(!keep.has(id)){ c.labelEl.remove(); c.group.removeFromParent(); c.neb.material.dispose(); clusters.delete(id); }
    for(const u of units){
      let c=clusters.get(u.group.id);
      if(!c){
        c={group:new THREE.Group(),neb:new THREE.Sprite(new THREE.SpriteMaterial({map:NEB_TEX[0],transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}))};
        c.labelEl=el('div','clusterlbl'); c.label=new CSS2DObject(c.labelEl); c.label.center.set(0.5,1);
        c.group.add(c.neb,c.label); homeLayer.add(c.group); clusters.set(u.group.id,c);
      }
      const goals=u.members.flatMap(m=>m.goals), done=goals.filter(g=>g.status==='done').length;
      c.ratio=goals.length? done/goals.length : 0;
      c.neb.material.color.set(u.group.color);
      c.group.position.set(GATE_R*1.08*Math.sin(u.angle),3,-GATE_R*1.08*Math.cos(u.angle));
      c.neb.scale.setScalar(16+u.span*GATE_R*1.3);
      c.label.position.set(0,7.5,0);
      c.labelEl.textContent=u.group.name;
      c.labelEl.style.color=u.group.color;
      c.labelEl.append(el('span','sub',`${u.members.length} people · ${done}/${goals.length} goals done`));
    }
  }
  function updateClusters(t){
    for(const c of clusters.values()){
      c.neb.material.opacity=0.07+0.28*c.ratio+0.03*Math.sin(t*0.8);
      c.neb.material.rotation+=0.0008;
    }
  }
  function updateGate(g,t,dt){
    g.mat.uniforms.uTime.value=t;
    g.group.position.copy(g.base); g.group.position.y+=Math.sin(t*0.7+g.phase)*0.4;
    // face the camera, leaning a little, like a tear hanging in space
    g.disc.quaternion.copy(camera.quaternion).multiply(g.tilt);
    g.hoverShown+=(g.hoverK-g.hoverShown)*Math.min(1,dt*6);   // the tear eases open on hover
    g.mat.uniforms.uHover.value=g.hoverShown;
    g.disc.scale.set(5.5,10,1);
    g.glow.scale.setScalar((7+Math.sin(t*1.5+g.phase)*0.5)*(1+0.3*g.hoverShown)*(g.visited?1.35:1));
    g.glow.material.opacity=(g.visited?0.55:0.3)*(0.4+0.6*g.mat.uniforms.uLife.value);
    g.label.position.copy(camDown).multiplyScalar(5.6);
  }
  function updateSystems(t,dt){
    let i=0;
    const lp=sunLinks.geometry.attributes.position;
    for(const s of systems.values()){
      s.root.visible= s.isMe? !visitSys : s===visitSys;
      s.sun.rotation.y+=dt*0.04;
      s.coronaInner.scale.setScalar(13*(1+0.04*Math.sin(t*1.3)));
      s.coronaOuter.scale.setScalar(28*(1+0.03*Math.sin(t*0.7+1)));
      s.label.position.copy(camDown).multiplyScalar(4.4);
    }
    for(const g of gates.values()){
      updateGate(g,t,dt);
      if(lp){ lp.setXYZ(i*2,0,0,0); lp.setXYZ(i*2+1,g.group.position.x,g.group.position.y,g.group.position.z); i++; }
    }
    if(lp) lp.needsUpdate=true;
    if(visitSys) updateGate(homeGate,t,dt);
  }
  let hoveredGate=null;
  function setGateHover(g){
    if(g===hoveredGate) return;
    if(hoveredGate){ hoveredGate.hoverK=0; hoveredGate.labelEl.classList.remove('hover'); }
    hoveredGate=g;
    if(g){ g.hoverK=1; g.labelEl.classList.add('hover'); }
  }
  const me=makeSystem('me',user.name,true);

  // ---------- footprints: connections who visited you in the last day leave a fading trail ----------
  const footprints=new Map();   // visitor id -> trail through your system
  function renderFootprints(){
    const want=new Map();
    for(const f of (social && social.friends)||[]) if(f.visitedMeAt) want.set(f.user.id,f);
    for(const [id,fp] of footprints) if(!want.has(id) || fp.at!==want.get(id).visitedMeAt){
      fp.line.removeFromParent(); fp.line.geometry.dispose(); fp.line.material.dispose();
      fp.spark.removeFromParent(); fp.spark.material.dispose(); fp.labelEl.remove(); footprints.delete(id);
    }
    for(const [id,f] of want){
      if(footprints.has(id)) continue;
      const seed=hashStr(id), r0=13+(seed%9), ph=(seed%628)/100;
      const pts=[];
      for(let i=0;i<24;i++){
        const a=i/24*Math.PI*2;
        const r=r0+6*Math.sin(a*2+ph)+3*Math.sin(a*3+ph*2);
        pts.push(new THREE.Vector3(Math.cos(a)*r,1.2*Math.sin(a*2+ph*3),Math.sin(a)*r));
      }
      const curve=new THREE.CatmullRomCurve3(pts,true);
      const color=personColor(id);
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(160)),
        new THREE.LineDashedMaterial({color,dashSize:0.5,gapSize:0.7,transparent:true,opacity:0.4,blending:THREE.AdditiveBlending,depthWrite:false}));
      line.computeLineDistances();
      const spark=glowSprite(color.getHex(),0.8,1.1);
      const labelEl=el('div','footlbl'); const label=new CSS2DObject(labelEl); label.center.set(0.5,0);
      spark.add(label);
      me.root.add(line,spark);
      footprints.set(id,{curve,line,spark,labelEl,color,at:f.visitedMeAt,name:f.user.name,phase:Math.random()});
    }
  }
  function updateFootprints(t,dt){
    for(const fp of footprints.values()){
      const age=(Date.now()-new Date(fp.at).getTime())/86400000;   // days
      const k=Math.max(0.08,1-age);
      fp.line.material.opacity=0.45*k;
      const u=(t*0.012+fp.phase)%1;
      fp.curve.getPointAt(u,fp.spark.position);
      fp.spark.material.opacity=0.8*k;
      fp.labelEl.textContent='👣 '+fp.name+' · '+relAgo(fp.at);
      fp.labelEl.style.opacity=String(0.35+0.5*k);
      if(me.root.visible && !reduceMotion && Math.random()<dt*10*k) emit(fp.spark.position,randDir().multiplyScalar(0.2),fp.color,0.8,0.8,0.97);
    }
  }

  // ---------- visitors: people in the same solar system as you right now ----------
  // At home you see connections who are visiting you; in a friend's system you see the friend (if
  // they're home) and anyone else visiting. Each shows as a comet on the side they're looking from.
  const sysPresence=new Map();   // host id -> Map(user id -> {focus, name})
  const visitors=new Map();      // user id -> visitor comet
  const shownHost=()=> view==='galaxy'? (visitSys? visitSys.key : myId) : null;
  function onSysPresence(d){
    const prev=sysPresence.get(d.hostId);
    const now=new Map(d.users.map(u=>[u.id,{focus:u.focus,name:u.name||'Someone'}]));
    sysPresence.set(d.hostId,now);
    const sys=systems.get(d.hostId); if(sys && !sys.isMe) labelGate(sys);
    if(d.hostId===shownHost() && prev){
      for(const [id,u] of now) if(id!==myId && !prev.has(id)){
        if(d.hostId===myId) continue;   // the "visit" event already says who's visiting you
        showToast(id===d.hostId? `${u.name} just came home. You're both here.` : `${u.name} is here too.`,{timeout:3500});
      }
    }
    syncVisitors();
  }
  function syncVisitors(){
    const host=shownHost(), here=host? sysPresence.get(host) : null;
    for(const [id,v] of [...visitors]) if(!here || !here.has(id) || v.host!==host){ v.head.removeFromParent(); v.head.material.dispose(); v.labelEl.remove(); visitors.delete(id); }
    if(!here) return;
    for(const [id,u] of here){
      if(id===myId) continue;
      let v=visitors.get(id);
      if(!v){
        const color=personColor(id);
        v={host,head:glowSprite(color.getHex(),1,1.8),color,dir:new THREE.Vector3(0,1,0),target:new THREE.Vector3(0,1,0),phase:Math.random()*6};
        v.labelEl=el('div','visitorlbl'); const label=new CSS2DObject(v.labelEl); label.center.set(0.5,0); label.position.set(0,1.2,0); v.head.add(label);
        scene.add(v.head); visitors.set(id,v);
      }
      v.labelEl.textContent=(id===host? '🏠 ' : '👀 ')+u.name;
      if(u.focus) v.target.fromArray(u.focus).normalize();
    }
  }
  function updateVisitors(t,dt){
    for(const v of visitors.values()){
      v.dir.lerp(v.target,Math.min(1,dt*1.5)).normalize();
      v.head.position.copy(v.dir).multiplyScalar(24).add(_bh2.set(Math.sin(t+v.phase),Math.cos(t*1.3+v.phase),0).multiplyScalar(0.6));
      v.head.material.opacity=0.8+0.2*Math.sin(t*4+v.phase);
      if(!reduceMotion && Math.random()<dt*25) emit(v.head.position,randDir().multiplyScalar(0.3),v.color,1,0.6,0.96);
    }
  }

  // ---------- camera: home view, fly-to, intro ----------
  // at home the view takes in the sun-gates too; in someone's system, just their rings
  function homeR(){ return !visitSys && gates.size? GATE_R+6 : RINGS.long+3.5; }
  function homeView(R=homeR()){
    const el=THREE.MathUtils.degToRad(camera.aspect<1?58:50);
    const halfV=THREE.MathUtils.degToRad(camera.fov/2), halfH=Math.atan(Math.tan(halfV)*camera.aspect);
    const d=Math.max(R*Math.sin(el)/Math.tan(halfV)*1.25, R/Math.tan(halfH)*1.15)*1.05;
    return {pos:new THREE.Vector3(0,d*Math.sin(el),d*Math.cos(el)), target:new THREE.Vector3()};
  }
  let camTween=null, savedView=null;
  function flyTo(pos,target,dur,done){
    if(reduceMotion) dur=0.001;
    const s0=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const s1=new THREE.Spherical().setFromVector3(pos.clone().sub(target));
    let dth=s1.theta-s0.theta;
    if(dth>Math.PI) dth-=Math.PI*2; if(dth<-Math.PI) dth+=Math.PI*2;
    camTween={s0,s1,dth,q0:controls.target.clone(),q1:target.clone(),t0:clockNow(),dur,done};
    controls.enabled=false; controls.autoRotate=false;
  }
  const _s=new THREE.Spherical(), _o=new THREE.Vector3();
  function stepTween(t){
    const tw=camTween, k=clamp01((t-tw.t0)/tw.dur), e=easeInOutCubic(k);
    controls.target.lerpVectors(tw.q0,tw.q1,e);
    _s.set(THREE.MathUtils.lerp(tw.s0.radius,tw.s1.radius,e),THREE.MathUtils.lerp(tw.s0.phi,tw.s1.phi,e),tw.s0.theta+tw.dth*e);
    camera.position.copy(controls.target).add(_o.setFromSpherical(_s));
    camera.lookAt(controls.target);
    if(k>=1){ camTween=null; controls.enabled=!gestureLock; controls.update(); if(tw.done) tw.done(); }
  }
  function flyHome(dur=1.2){ savedView=null; const v=homeView(); flyTo(v.pos,v.target,dur); }
  function intro(){ controls.autoRotate=false; flyHome(3.0); }
  function flyToSystem(sys){
    if(!sys) return;
    if(sys.isMe || sys===visitSys){ flyHome(); return; }
    visitFriend(sys.key);
  }
  // pull back far enough to see every gate and multiverse portal
  function flyOverview(){
    savedView=null;
    let R=homeR();
    for(const p of portals.values()) R=Math.max(R,p.base.length()+8,p.sky? p.sky.length()*0.8 : 0);
    const v=homeView(R);
    flyTo(v.pos,v.target,1.6);
  }
  function restoreView(){
    if(!savedView) return;
    const v=savedView; savedView=null;
    flyTo(v.pos,v.target,1.0);
  }
  function focusGoal(id){
    const p=planets.get(id); if(!p) return;
    if(!savedView) savedView={pos:camera.position.clone(),target:controls.target.clone()};
    orbitK=0;
    const P= p.bh? p.group.position.clone() : toRingWorld(p.target,p.tf);
    const dir=camera.position.clone().sub(controls.target).normalize();
    const dist=6+p.radius*5;
    // shift the view so the planet stays visible beside the detail card (right on desktop, bottom on phones)
    const narrow=innerWidth<=640;
    const target=P.clone().add((narrow?camDown:camRight).clone().multiplyScalar(dist*(narrow?0.3:0.25)));
    flyTo(target.clone().add(dir.multiplyScalar(dist)),target,1.1);
    openDetail(id);
  }

  // ---------- pointer: tap / hover / double-tap ----------
  const raycaster=new THREE.Raycaster(), ndc=new THREE.Vector2();
  let down=null, lastTap=null, hoverPtr=null, hoveredId=null, frameNo=0;
  function pickAt(x,y){
    const r=canvas.getBoundingClientRect();
    ndc.set(((x-r.left)/r.width)*2-1,-((y-r.top)/r.height)*2+1);
    raycaster.setFromCamera(ndc,camera);
    const hits=raycaster.intersectObjects(view==='mv'? mvHitMeshes : hitMeshes,false);
    const h=hits.find(x=>shown(x.object));   // hit shapes inside a hidden system or layer don't count
    return h? h.object.userData : null;   // {id} planet, {sys} sun, {mv} portal, {moon}/{mvPlanet} inside a multiverse
  }
  function shown(o){ for(let x=o.parent;x;x=x.parent) if(!x.visible) return false; return true; }
  function setHover(id){
    if(id===hoveredId) return;
    const prev=planets.get(hoveredId);
    if(prev){ prev.hoverTarget=1; prev.labelEl.classList.remove('hover'); }
    hoveredId=id;
    const p=planets.get(id);
    if(p){ p.hoverTarget=1.3; p.labelEl.classList.add('hover'); }
    canvas.style.cursor=p?'pointer':'';
  }
  canvas.addEventListener('pointerdown',e=>{
    down={x:e.clientX,y:e.clientY,t:performance.now()};
    if(!e.isPrimary || e.button!==0){ cancelHold(); return; }   // a second finger means pinch-zoom; right-drag pans
    gestureUsed=false;
    beginHold(e.clientX,e.clientY);
  });
  canvas.addEventListener('contextmenu',e=>e.preventDefault());   // long presses are gestures here
  canvas.addEventListener('pointerup',e=>{
    if(!down) return;
    const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y), held=performance.now()-down.t;
    down=null;
    if(gestureUsed || bang) return;   // the press was a hold gesture, or the big bang is playing
    if(moved>7 || held>650) return;   // that was a drag, not a tap
    const hit=pickAt(e.clientX,e.clientY);
    if(hit && hit.id){ lastTap=null; focusGoal(hit.id); return; }
    if(hit && hit.sys){ lastTap=null; flyToSystem(systems.get(hit.sys)); return; }
    if(hit && hit.gate){ lastTap=null; visitFriend(hit.gate); return; }
    if(hit && hit.home){ lastTap=null; exitVisit(); return; }
    if(hit && hit.mv){ lastTap=null; enterMultiverse(hit.mv); return; }
    if(hit && hit.moon){ lastTap=null; tapMoon(hit.moon); return; }
    if(hit && hit.act){ lastTap=null; tapActivity(hit.act); return; }
    if(hit && hit.mvPlanet){
      // double-tap a band to cheer whoever finished it
      const now=performance.now();
      if(lastTap && lastTap.planet && now-lastTap.t<350 && Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<30){ lastTap=null; cheerAt(e.clientX,e.clientY); return; }
      lastTap={t:now,x:e.clientX,y:e.clientY,planet:true}; tapMvPlanet(); return;
    }
    const now=performance.now();
    if(lastTap && now-lastTap.t<350 && Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<30){ lastTap=null; if(view==='mv') mvHome(); else flyHome(); }
    else lastTap={t:now,x:e.clientX,y:e.clientY};
  });
  canvas.addEventListener('pointermove',e=>{ if(e.pointerType==='mouse') hoverPtr={x:e.clientX,y:e.clientY}; });
  canvas.addEventListener('pointerleave',()=>{ hoverPtr=null; setHover(null); setGateHover(null); });
  $('viewBtn').addEventListener('click',()=>flyHome());
  $('allBtn').addEventListener('click',flyOverview);
  function renderOrbitBtn(){ $('orbitBtn').textContent=orbitOn?'⏸ orbit':'▶ orbit'; }
  $('orbitBtn').addEventListener('click',()=>{
    orbitOn=!orbitOn; renderOrbitBtn();
    try{ localStorage.setItem(ORBIT_KEY,orbitOn?'on':'off'); }catch(e){}
  });
  renderOrbitBtn();
  function updateOrbits(dt){
    // pause while a planet's card or the goal form is open
    const want=(orbitOn && !detailOverlay.classList.contains('show') && !formOverlay.classList.contains('show'))?1:0;
    orbitK+=(want-orbitK)*Math.min(1,dt*1.5);
    for(const tf in ringPhase){
      ringPhase[tf]=(ringPhase[tf]+dt*orbitK*Math.PI*2/ORBIT_PERIOD[tf])%(Math.PI*2);
      for(const s of systems.values()) s.ringGroups[tf].rotation.y=-ringPhase[tf];
    }
  }

  // ---------- render loop ----------
  let lastT=clockNow(), fpsTime=0, fpsFrames=0, tickFar=null;
  function applyPixelRatio(){
    renderer.setPixelRatio(pixelRatio); composer.setPixelRatio(pixelRatio);
    composer.setSize(innerWidth,innerHeight);
    starLayers.forEach(s=>s.material.uniforms.uPR.value=pixelRatio);
    pMat.uniforms.uPR.value=pixelRatio;
  }
  function frame(){
    const t=clockNow(), dt=Math.min(0.05,t-lastT); lastT=t;
    camDown.set(0,-1,0).applyQuaternion(camera.quaternion);
    camRight.set(1,0,0).applyQuaternion(camera.quaternion);

    sunUniforms.uTime.value=t;
    starLayers.forEach(s=>s.material.uniforms.uTime.value=t);
    farStars.rotation.y+=dt*0.002; nearDust.rotation.y+=dt*0.006;
    updateBang(t,dt);
    nextBang();
    stepPresence(t);
    if(view==='mv') updateMvScene(t,dt);
    else{
      updateSystems(t,dt*timeScale);
      updateOrbits(dt*timeScale);
      if(!reduceMotion) updatePulses(t);
      for(const p of planets.values()) p.update(t,dt);
      for(let i=dying.length-1;i>=0;i--) if(!dying[i].update(t,dt)) dying.splice(i,1);
      updatePortals(t,dt);
      updateCast();
      for(const th of [...threads]) th.update(t,dt);
      updateLinks(t);
      updateBlackHoles(t,dt);
      updateFootprints(t,dt);
      updateVisitors(t,dt);
      updateClusters(t);
      stepMelody(t);
    }
    stepHold(t);
    stepWarp(t);
    updateShooting(t,dt);
    updateParticles(dt);
    updateShockwaves(t);

    if(camTween) stepTween(t); else controls.update();
    if(hoverPtr && !camTween && (frameNo++&1)===0){
      const h=pickAt(hoverPtr.x,hoverPtr.y);
      setHover(h && h.id || null);
      setMoonHover(h && h.moon || null);
      setActHover(h && h.act || null);
      setGateHover(h && (h.gate? gates.get(h.gate) : h.home? homeGate : null) || null);
      canvas.style.cursor=h?'pointer':'';
    }

    const far=camera.position.distanceTo(controls.target)>170;
    if(far!==tickFar){ tickFar=far; labelRenderer.domElement.style.setProperty('--tick-o',far?'0.3':'1'); }

    composer.render();
    if(view==='mv') mvLabelRenderer.render(mvScene,camera); else labelRenderer.render(scene,camera);

    // adaptive quality: lower the resolution if the device can't keep up
    fpsTime+=dt; fpsFrames++;
    if(fpsTime>=2){
      const fps=fpsFrames/fpsTime; fpsTime=0; fpsFrames=0;
      if(fps<40 && pixelRatio>0.8){ pixelRatio=Math.max(0.8,pixelRatio*0.8); applyPixelRatio(); }
    }
  }
  renderer.setAnimationLoop(frame);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){ renderer.setAnimationLoop(null); leavePresence(); }
    else{ lastT=clockNow(); fpsTime=0; fpsFrames=0; renderer.setAnimationLoop(frame); refreshFromServer(); }
  },{signal});
  addEventListener('resize',()=>{
    const w=innerWidth,h=innerHeight;
    camera.aspect=w/h; camera.updateProjectionMatrix();
    renderer.setSize(w,h); composer.setSize(w,h); labelRenderer.setSize(w,h); mvLabelRenderer.setSize(w,h);
  },{signal});

  // =====================================================================
  // FORM + DETAIL
  // =====================================================================
  const formOverlay=$('formOverlay'), detailOverlay=$('detailOverlay');
  let editingId=null, detailId=null, detailSys=null, tfTouched=false, formMode='goal';
  let curImportance='medium', curTimeframe='short', curStatus='ongoing', curAudience='shared', curShares=new Set();

  function setSeg(segId,val){
    document.querySelectorAll('#'+segId+' button').forEach(b=>b.classList.toggle('active',b.dataset.v===val));
  }
  function updateTfHint(){
    const date=$('goalDate').value;
    const el=$('tfHint');
    if(!date){ el.textContent=''; return; }
    const p=placement({timeframe:curTimeframe,date});
    if(p.state==='later') el.textContent=`That date is beyond the ${curTimeframe} ring (${SPANS[curTimeframe].label}) and will sit in the "later" gap. Suggested: ${suggestTimeframe(date)}.`;
    else if(p.state==='past') el.textContent='That date is in the past. It will sit in the dashed "past" gap at the end of its ring.';
    else el.textContent='';
  }
  $('segImportance').addEventListener('click',e=>{
    if(e.target.tagName!=='BUTTON') return;
    curImportance=e.target.dataset.v; setSeg('segImportance',curImportance);
  });
  $('segTime').addEventListener('click',e=>{
    if(e.target.tagName!=='BUTTON') return;
    curTimeframe=e.target.dataset.v; tfTouched=true; setSeg('segTime',curTimeframe); updateTfHint();
  });
  $('segPrivacy').addEventListener('click',e=>{
    if(e.target.tagName!=='BUTTON') return;
    curAudience=e.target.dataset.v; setSeg('segPrivacy',curAudience); renderSharePick();
  });
  // with "Chosen people", tick which connections see the goal
  function renderSharePick(){
    const box=$('sharePick'); box.textContent='';
    box.style.display=curAudience==='chosen'?'':'none';
    if(curAudience!=='chosen') return;
    if(!social.friends.length){ box.append(el('p','sempty','You have no connections yet, so only you will see it.')); return; }
    for(const f of social.friends){
      const lab=el('label','pick'), cb=el('input'); cb.type='checkbox'; cb.checked=curShares.has(f.user.id);
      cb.addEventListener('change',()=>{ if(cb.checked) curShares.add(f.user.id); else curShares.delete(f.user.id); });
      lab.append(cb,document.createTextNode(f.user.name)); box.append(lab);
    }
  }
  $('segStatus').addEventListener('click',e=>{
    if(e.target.tagName!=='BUTTON') return;
    curStatus=e.target.dataset.v; setSeg('segStatus',curStatus);
  });
  $('goalDate').addEventListener('change',()=>{
    const d=$('goalDate').value;
    if(d && !tfTouched){ curTimeframe=suggestTimeframe(d); setSeg('segTime',curTimeframe); }
    updateTfHint();
  });
  $('goalName').addEventListener('input',()=>$('goalName').classList.remove('err'));
  // ---------- notes editor ----------
  const notesEl=$('goalNotes');
  let savedRange=null;
  try{ document.execCommand('defaultParagraphSeparator',false,'p'); }catch(e){}
  function refreshNotesState(){
    notesEl.classList.toggle('empty',!notesEl.textContent.trim() && !notesEl.querySelector('li'));
  }
  function focusEnd(el){
    el.focus();
    const r=document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s=getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function selectionInNotes(){ const s=getSelection(); return s.rangeCount>0 && notesEl.contains(s.anchorNode); }
  function currentLink(){
    let n=getSelection().anchorNode;
    while(n && n!==notesEl){ if(n.nodeName==='A') return n; n=n.parentNode; }
    return null;
  }
  function blockIs(tag){ try{ return document.queryCommandValue('formatBlock').toLowerCase()===tag; }catch(e){ return false; } }
  function updateToolbar(){
    if(!formOverlay.classList.contains('show')) return;
    const inside=selectionInNotes();
    document.querySelectorAll('#rteBar button').forEach(b=>{
      const c=b.dataset.cmd; let on=false;
      if(inside){
        if(c==='heading') on=blockIs('h3')||blockIs('h4');
        else if(c==='quote') on=blockIs('blockquote');
        else if(c==='link') on=!!currentLink();
        else if(c!=='removeFormat'){ try{ on=document.queryCommandState(c); }catch(e){} }
      }
      b.classList.toggle('on',on);
    });
  }
  document.addEventListener('selectionchange',updateToolbar,{signal});
  $('rteBar').addEventListener('mousedown',e=>{ if(e.target.closest('button')) e.preventDefault(); });   // keep the text selection
  $('rteBar').addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    const c=b.dataset.cmd;
    if(!selectionInNotes()) focusEnd(notesEl);
    if(c==='link'){ openLinkBox(); return; }
    if(c==='heading') document.execCommand('formatBlock',false,(blockIs('h3')||blockIs('h4'))?'p':'h3');
    else if(c==='quote') document.execCommand('formatBlock',false,blockIs('blockquote')?'p':'blockquote');
    else if(c==='removeFormat'){ document.execCommand('removeFormat'); document.execCommand('unlink'); }
    else document.execCommand(c);
    refreshNotesState(); updateToolbar();
  });
  function openLinkBox(){
    const s=getSelection();
    savedRange=s.rangeCount? s.getRangeAt(0).cloneRange() : null;
    const a=currentLink();
    $('rteLinkInput').value=a? a.getAttribute('href') : '';
    $('rteLinkInput').classList.remove('err');
    $('rteUnlink').style.display=a?'':'none';
    $('rteLink').classList.add('show');
    $('rteLinkInput').focus();
  }
  function closeLinkBox(refocus=true){
    $('rteLink').classList.remove('show');
    if(refocus && savedRange){ notesEl.focus(); const s=getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
  }
  function applyLink(){
    const url=safeUrl($('rteLinkInput').value);
    if(!url){ $('rteLinkInput').classList.add('err'); return; }
    closeLinkBox(true);
    const a=currentLink();
    if(a) a.setAttribute('href',url);
    else if(getSelection().isCollapsed) document.execCommand('insertHTML',false,`<a href="${escHtml(url)}">${escHtml(url)}</a>&nbsp;`);
    else document.execCommand('createLink',false,url);
    refreshNotesState(); updateToolbar();
  }
  $('rteLinkOk').addEventListener('click',applyLink);
  $('rteUnlink').addEventListener('click',()=>{
    closeLinkBox(true);
    const a=currentLink();
    if(a){ const r=document.createRange(); r.selectNodeContents(a); const s=getSelection(); s.removeAllRanges(); s.addRange(r); }
    document.execCommand('unlink');
    updateToolbar();
  });
  $('rteLinkInput').addEventListener('keydown',e=>{
    if(e.key==='Enter'){ e.preventDefault(); applyLink(); }
    else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeLinkBox(true); }
  });
  notesEl.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); openLinkBox(); }
  });
  notesEl.addEventListener('input',()=>{
    refreshNotesState();
    const n=notesEl.innerHTML.length;
    $('notesHint').textContent= n>NOTES_MAX*0.85? `Notes are getting long: ${n.toLocaleString()} of ${NOTES_MAX.toLocaleString()} characters allowed.` : '';
  });
  // paste keeps simple formatting only (see sanitizeHtml); no images or styles
  notesEl.addEventListener('paste',e=>{
    e.preventDefault();
    const html=e.clipboardData.getData('text/html'), text=e.clipboardData.getData('text/plain');
    if(html) document.execCommand('insertHTML',false,sanitizeHtml(html));
    else if(!/\n/.test(text)) document.execCommand('insertText',false,text);
    else document.execCommand('insertHTML',false,textToHtml(text));
    refreshNotesState();
  });
  notesEl.addEventListener('drop',e=>{ if(e.dataTransfer && e.dataTransfer.files.length) e.preventDefault(); });

  function openForm(goalToEdit,opts={}){
    formMode='goal';
    $('tfField').style.display=''; $('privacyField').style.display=''; $('formApprovalHint').textContent='';
    if(goalToEdit){
      editingId=goalToEdit.id;
      $('formTitle').textContent='Edit Goal';
      $('goalName').value=goalToEdit.name;
      $('goalCategory').value=goalToEdit.category;
      $('goalDate').value=goalToEdit.date;
      curImportance=goalToEdit.importance; curTimeframe=goalToEdit.timeframe; curStatus=goalToEdit.status;
      curAudience=goalToEdit.isPrivate?'private':goalToEdit.limited?'chosen':'shared'; curShares=new Set(goalToEdit.sharedWith||[]);
      $('goalWhy').value=goalToEdit.why||'';
      notesEl.innerHTML=sanitizeHtml(goalToEdit.notes);
      tfTouched=true;
    }else{
      editingId=null;
      $('formTitle').textContent='New Goal';
      $('goalName').value=''; $('goalCategory').value='';
      $('goalDate').value=todayISO();
      curImportance='medium'; curTimeframe='short'; curStatus='ongoing'; curAudience='shared'; curShares=new Set();
      $('goalWhy').value='';
      notesEl.innerHTML='';
      tfTouched=false;
    }
    $('goalName').classList.remove('err');
    setSeg('segImportance',curImportance); setSeg('segTime',curTimeframe); setSeg('segStatus',curStatus);
    setSeg('segPrivacy',curAudience); renderSharePick();
    $('whyField').style.display='';
    updateTfHint();
    closeLinkBox(false);
    $('notesHint').textContent='';
    refreshNotesState();
    formOverlay.classList.add('show');
    setTimeout(()=>{ if(opts.focusNotes) focusEnd(notesEl); else $('goalName').focus(); },50);
  }
  function closeForm(){ formOverlay.classList.remove('show'); restoreView(); }
  $('addBtn').addEventListener('click',()=>openForm());
  $('cancelBtn').addEventListener('click',closeForm);
  function submitForm(){
    const nameEl=$('goalName'), name=nameEl.value.trim();
    if(!name){ nameEl.classList.add('err'); nameEl.focus(); return; }
    const category=$('goalCategory').value.trim() || 'General';
    const date=normalizeDate($('goalDate').value) || todayISO();
    const notesHtml=sanitizeHtml(notesEl.innerHTML);
    const notes=htmlToText(notesHtml)? notesHtml : '';
    if(notes.length>NOTES_MAX){
      $('notesHint').textContent=`Notes are too long (${notes.length.toLocaleString()} of ${NOTES_MAX.toLocaleString()} characters, formatting included). Please shorten them.`;
      notesEl.focus(); return;
    }
    if(formMode==='mv'){
      formOverlay.classList.remove('show');
      mvChange({kind:'GOAL_UPDATE',payload:{name,category,importance:curImportance,date,status:curStatus,notes}});
      return;
    }
    const fields={name,category,importance:curImportance,timeframe:curTimeframe,date,status:curStatus,notes,
      isPrivate:curAudience==='private',limited:curAudience==='chosen',sharedWith:curAudience==='chosen'?[...curShares]:[],why:$('goalWhy').value.trim().slice(0,500)};
    let saved;
    if(editingId){
      saved=goals.find(g=>g.id===editingId);
      if(saved) Object.assign(saved,fields);
    }else{ saved={id:newId(),...EMPTY_EXTRAS(),...fields}; goals.push(saved); }
    formOverlay.classList.remove('show');
    syncScene('user');
    if(saved) persist({type:'save',goal:cleanGoal(saved)});
    if(savedView) setTimeout(restoreView,editingId?500:0);
  }
  $('saveBtn').addEventListener('click',submitForm);
  ['goalName','goalCategory'].forEach(id=>$(id).addEventListener('keydown',e=>{ if(e.key==='Enter') submitForm(); }));

  function relTime(iso,status){
    const days=Math.round((isoToDate(iso)-today())/86400000);
    if(days===0) return 'today';
    const a=Math.abs(days);
    const txt= a<45? a+' day'+(a===1?'':'s') : a<730? (m=>m+' month'+(m===1?'':'s'))(Math.round(a/30.44)) : (a/365.25).toFixed(1).replace(/\.0$/,'')+' years';
    if(days>0) return 'in '+txt;
    return status==='ongoing'? 'overdue by '+txt : txt+' ago';
  }
  function openDetail(id,keepScroll=false){
    const p=planets.get(id), sys=p? p.sys : me;
    const g=sysGoals(sys).find(g=>g.id===id);
    if(!g) return;
    detailId=id; detailSys=sys;
    disarmDelete();
    const mine=sys.isMe && !readOnly;
    $('dOwner').textContent= readOnly? user.name+"'s goal" : sys.isMe? '' : sys.name+"'s goal";
    $('dEdit').style.display=mine?'':'none';
    $('dDelete').style.display=mine?'':'none';
    const chosen=(g.sharedWith||[]).length;
    $('dPrivacy').textContent=mine? 'Visible to: '+(g.isPrivate?'only you 🔒' : g.limited? `you and ${chosen} chosen ${chosen===1?'person':'people'}` : 'you and your connections') : '';
    $('dNotes').title=sys.isMe?'Click to edit notes':'';
    $('dName').textContent=g.name;
    $('dCategory').textContent='Category: '+g.category;
    $('dImportance').textContent='Importance: '+(g.importance==='low'?'Not necessary':g.importance[0].toUpperCase()+g.importance.slice(1));
    $('dTimeframe').textContent='Timeframe: '+g.timeframe[0].toUpperCase()+g.timeframe.slice(1)+' term';
    $('dDate').textContent='Target date: '+isoToDate(g.date).toLocaleDateString()+' ('+relTime(g.date,g.status)+')';
    $('dStatus').textContent='Status: '+({ongoing:'Ongoing',done:'Done',notdone:'Not done'}[g.status]);
    const pl=placement(g);
    $('dNote').textContent = !sys.isMe? '' : pl.state==='later'
      ? `This date is beyond the ${g.timeframe} ring's ${SPANS[g.timeframe].label}, so it sits in the "later" gap. Try a longer timeframe.`
      : (pl.state==='past' && g.status==='ongoing') ? 'The target date has passed. Mark it done, or edit the date.' : '';
    const nv=$('dNotes');
    if(g.notes){ nv.innerHTML=sanitizeHtml(g.notes); nv.classList.remove('empty'); }
    else{ nv.textContent=sys.isMe?'No notes yet. Click here to add some.':'No notes.'; nv.classList.add('empty'); }
    if(!keepScroll) nv.scrollTop=0;
    renderDetailExtras(g,sys);
    detailOverlay.classList.add('show');
    // the owner has now seen the notes left on it
    if(mine && (g.guestNotes||[]).some(n=>n.unread)){
      g.guestNotes.forEach(n=>n.unread=false);
      const p=planets.get(g.id); if(p) p.syncExtras(g,clockNow());
      api.markNotesRead(g.id).catch(()=>{});
    }
  }
  // everything below the notes: why it matters, steps (moons), mentors' suggestions, links, the time
  // capsule, the guestbook, and for a friend's goal, copying it into your own galaxy
  function renderDetailExtras(g,sys){
    const box=$('dExtras'); box.textContent='';
    const mine=sys.isMe && !readOnly;
    const friend=!sys.isMe && !readOnly? social.friends.find(f=>f.user.id===sys.key) : null;
    const after=async()=>{ if(mine) await refreshGoals(); else await refreshSocial(true); };
    const act=async(p,okMsg)=>{ const r=await p; if(r && r.error){ showToast(r.error); return false; } if(okMsg) showToast(okMsg); await after(); return true; };
    const inputRow=(placeholder,label,onSubmit,max=200)=>{
      const row=el('div','srow'), inp=el('input'); inp.type='text'; inp.maxLength=max; inp.placeholder=placeholder;
      const go=async()=>{ const v=inp.value.trim(); if(!v) return; inp.disabled=true; if(await onSubmit(v)) inp.value=''; inp.disabled=false; };
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); go(); } });
      row.append(inp,btn(label,'',go)); return row;
    };

    if(g.why){ const w=el('div','dwhy'+(isOverdue(g)?' overdue':'')); w.append(el('b',null,'Why it matters: '),g.why); box.append(w); }
    if(mine && g.status==='notdone'){
      box.append(el('p','dnote','This goal is circling the black hole.'),btn('↩ Pull it back out','',async()=>{
        g.status='ongoing'; syncScene('user'); persist({type:'save',goal:cleanGoal(g)}); sound.chime(); openDetail(g.id,true);
      }));
    }

    // steps: each is a moon, lit when done
    const steps=g.steps||[], accepted=steps.filter(x=>!x.pending), waiting=steps.filter(x=>x.pending);
    if(accepted.length || mine){
      const lit=accepted.filter(x=>x.done).length;
      box.append(el('h4',null,'Steps'+(accepted.length? ` · ${lit} of ${accepted.length} moons lit` : '')));
      const list=el('div','dsteps');
      for(const st of accepted){
        const row=el('div','ms'+(st.done?' done':''));
        const tick=el('button','tick'+(st.done?' on':''),st.done?'✓':''); tick.disabled=!mine;
        if(st.done) tick.style.background=COLORS[g.importance];
        tick.addEventListener('click',()=>act(api.updateStep(st.id,{done:!st.done})));
        const who=el('div','who'); who.append(el('div','nm',st.title));
        if(st.suggestedBy) who.append(el('div','sub','suggested by '+st.suggestedBy.name));
        row.append(tick,who);
        if(mine){ const del=confirmBtn('🗑',()=>act(api.deleteStep(st.id))); del.classList.add('ib'); row.append(del); }
        list.append(row);
      }
      if(!accepted.length) list.append(el('p','sempty','Break it into steps. Each one becomes a moon.'));
      box.append(list);
      if(mine) box.append(inputRow('Add a step…','Add',v=>act(api.addStep(g.id,v))));
    }
    if(waiting.length && (mine || friend)){
      box.append(el('h4',null,mine? 'Suggested by your mentors' : 'Your suggestions'));
      for(const st of waiting){
        box.append(mine
          ? personRow(st.title,'from '+(st.suggestedBy? st.suggestedBy.name : 'a former mentor'),
              btn('Accept','',()=>act(api.decideStep(st.id,true),'Added as a step.')),
              btn('Decline','ghost',()=>act(api.decideStep(st.id,false))))
          : personRow(st.title,'waiting for '+sys.name));
      }
    }
    if(friend && friend.iMentor){
      box.append(el('h4',null,'🎓 Suggest a step'),inputRow('What should they do next?','Suggest',v=>act(api.suggestStep(g.id,v),`Sent to ${sys.name}.`)));
    }

    // links: goals that feed into each other
    const all=sysGoals(sys), linked=all.filter(o=>o.id!==g.id && ((g.links||[]).includes(o.id) || (o.links||[]).includes(g.id)));
    if(linked.length || (mine && all.length>1)){
      box.append(el('h4',null,'Linked goals'));
      for(const o of linked){
        const feeds=(g.links||[]).includes(o.id);
        box.append(personRow((feeds?'→ ':'← ')+o.name,feeds? 'this feeds into it' : 'it feeds into this',
          ...(mine? [btn('Unlink','ghost',()=>act(api.unlinkGoals(g.id,o.id)))] : [])));
      }
      const others=all.filter(o=>o.id!==g.id && !linked.includes(o));
      if(mine && others.length){
        const row=el('div','srow'), sel=el('select');
        others.forEach(o=>{ const op=el('option',null,o.name); op.value=o.id; sel.append(op); });
        row.append(el('span','lbl-sub','Feeds into'),sel,btn('Link','',()=>act(api.linkGoals(g.id,sel.value))));
        box.append(row);
      }
    }

    // time capsule: a letter to your future self
    if(mine){
      box.append(el('h4',null,'💌 Letter to your future self'));
      const cap=g.capsule||{state:'none'};
      const writer=(label)=>{
        const wrap=el('div','capw'), ta=el('textarea'); ta.maxLength=5000; ta.rows=4;
        ta.placeholder='Dear future me… (you can\'t read it again until you finish this goal or its date arrives)';
        wrap.append(ta,btn(label,'',async()=>{
          const v=ta.value.trim(); if(!v){ ta.focus(); return; }
          if(await act(api.setCapsule(g.id,v),'Sealed. It opens when you finish this goal, or on '+isoToDate(g.date).toLocaleDateString()+'.')) sound.sparkle();
        }));
        return wrap;
      };
      if(cap.state==='open'){
        const letter=el('div','capsule open'); letter.append(el('div','caphead','Opened ✨'),el('div','captext',cap.text));
        box.append(letter);
        const again=el('button','linkbtn','Write a new letter'); again.addEventListener('click',()=>again.replaceWith(writer('Seal it 💌'))); box.append(again);
      }else if(cap.state==='sealed'){
        box.append(el('div','capsule sealed','🔒 Sealed. It opens when you finish this goal, or on '+isoToDate(g.date).toLocaleDateString()+'.'));
        const again=el('button','linkbtn','Replace it with a new letter'); again.addEventListener('click',()=>again.replaceWith(writer('Seal the new one 💌'))); box.append(again);
      }else box.append(writer('Seal it 💌'));
    }

    // guestbook: notes from connections, each drawn as a comet around the planet
    const notes=g.guestNotes||[];
    if(!readOnly && (notes.length || friend || mine)){
      box.append(el('h4',null,'💬 Notes'+(notes.length?` (${notes.length})`:'')));
      for(const n of notes){
        const row=el('div','gnote');
        const head=el('div','gnh'), dot=el('span','mdot'); dot.style.background='#'+personColor(n.author.id).getHexString();
        head.append(dot,el('b',null,n.author.id===myId?'You':n.author.name),el('span','when',relAgo(n.at)));
        if(n.author.id===myId || mine){ const del=el('button','ib','✕'); del.title='Delete note'; del.addEventListener('click',()=>act(api.deleteNote(n.id))); head.append(del); }
        row.append(head,el('div','gnt',n.text));
        box.append(row);
      }
      if(!notes.length) box.append(el('p','sempty',mine? 'When friends visit, they can leave notes here.' : 'Be the first to leave a note.'));
      box.append(inputRow(mine? 'Reply…' : `Leave ${sys.name} a note…`,'Send',async v=>{ const ok=await act(api.addNote(g.id,v)); if(ok){ sound.sparkle(); const p=planets.get(g.id); if(p) dustBurst(p.world(),personColor(myId)); } return ok; },280));
    }

    // borrow a friend's goal
    if(friend){
      box.append(btn('✨ Copy to my galaxy','copybtn',async()=>copyGoal(g,sys)));
    }
  }
  // a copy of a friend's goal flies out through the home rift into your galaxy
  function copyGoal(g,sys){
    const copy={...EMPTY_EXTRAS(),id:newId(),name:g.name,category:g.category,importance:g.importance,timeframe:g.timeframe,
      date:g.date<todayISO()? todayISO() : g.date,status:'ongoing',notes:g.notes||'',isPrivate:false};
    goals.push(copy);
    syncScene('user');
    persist({type:'save',goal:cleanGoal(copy)});
    const p=planets.get(g.id);
    if(p && !reduceMotion){
      const from=p.world(), to=homeGate.group.position.clone(), head=glowSprite(0xffd27a,1,1.6); scene.add(head);
      const t0=clockNow(), col=new THREE.Color(0xffd27a);
      const fly=()=>{
        const k=clamp01((clockNow()-t0)/1.3); head.position.lerpVectors(from,to,easeInOutCubic(k)); head.position.y+=Math.sin(k*Math.PI)*6;
        emit(head.position,randDir().multiplyScalar(0.3),col,1.2,0.5,0.96);
        if(k<1 && !disposed) requestAnimationFrame(fly); else{ head.removeFromParent(); head.material.dispose(); dustBurst(to,col); }
      };
      fly();
    }
    sound.sparkle();
    showToast(`✨ "${g.name}" is now in your galaxy too.`);
  }
  function closeDetail(fly=true){
    detailOverlay.classList.remove('show');
    disarmDelete();
    if(fly) restoreView();
  }
  $('dClose').addEventListener('click',()=>closeDetail());
  $('dX').addEventListener('click',()=>closeDetail());
  detailOverlay.addEventListener('click',e=>{ if(e.target===detailOverlay) closeDetail(); });
  $('dNotes').addEventListener('click',e=>{
    if(e.target.closest('a')) return;   // links open normally
    if(!detailSys || !detailSys.isMe || readOnly) return;
    const g=goals.find(g=>g.id===detailId);
    if(!g) return;
    closeDetail(false);
    openForm(g,{focusNotes:true});
  });
  $('dEdit').addEventListener('click',()=>{
    const g=goals.find(g=>g.id===detailId);
    if(!g) return;
    closeDetail(false);
    openForm(g);
  });
  // delete needs a second tap within 3s
  let deleteTimer=null;
  function disarmDelete(){ clearTimeout(deleteTimer); const b=$('dDelete'); b.classList.remove('armed'); b.textContent='Delete'; }
  $('dDelete').addEventListener('click',()=>{
    const b=$('dDelete');
    if(!b.classList.contains('armed')){
      b.classList.add('armed'); b.textContent='Tap again';
      deleteTimer=setTimeout(disarmDelete,3000);
      return;
    }
    const id=detailId;
    goals=goals.filter(g=>g.id!==id);
    closeDetail(false);
    syncScene('user');
    persist({type:'delete',id});
    setTimeout(restoreView,600);
  });

  // ---------- connections panel ----------
  const socialOverlay=$('socialOverlay');
  let social={incoming:[],outgoing:[],friends:[],groups:[],publicSlug:null}, socialBusy=false;
  function el(tag,cls,text){ const n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n; }
  function btn(label,cls,onClick){
    const b=el('button','sbtn'+(cls?' '+cls:''),label);
    b.addEventListener('click',async()=>{ if(b.disabled) return; b.disabled=true; try{ await onClick(b); }finally{ if(b.isConnected) b.disabled=false; } });
    return b;
  }
  // a button that needs a second tap within 3s
  function confirmBtn(label,onConfirm){
    let timer=null;
    const b=el('button','sbtn warn',label);
    b.addEventListener('click',async()=>{
      if(!b.classList.contains('armed')){ b.classList.add('armed'); b.textContent='Tap again'; timer=setTimeout(()=>{ b.classList.remove('armed'); b.textContent=label; },3000); return; }
      clearTimeout(timer); b.disabled=true;
      try{ await onConfirm(); }finally{ if(b.isConnected) b.disabled=false; }
    });
    return b;
  }
  function personRow(name,sub,...buttons){
    const row=el('div','sperson'), who=el('div','who');
    who.append(el('div','nm',name));
    if(sub) who.append(el('div','sub',sub));
    row.append(who,...buttons);
    return row;
  }
  function fill(id,rows,emptyText){
    const box=$(id); box.textContent='';
    if(rows.length) box.append(...rows); else if(emptyText) box.append(el('p','sempty',emptyText));
  }
  function renderSocial(){
    const n=social.incoming.length, badge=$('socialBadge');
    badge.textContent=n>9?'9+':String(n); badge.classList.toggle('show',n>0);
    $('sIncomingSec').classList.toggle('hide',!social.incoming.length);
    $('sOutgoingSec').classList.toggle('hide',!social.outgoing.length);
    fill('sIncoming',social.incoming.map(r=>personRow(r.name,r.email,
      btn('Accept','',async()=>{ await api.respondConnect(r.connectionId,true); showToast(`You're now connected with ${r.name}.`); await refreshSocial(true); }),
      btn('Decline','ghost',async()=>{ await api.respondConnect(r.connectionId,false); await refreshSocial(true); }))));
    fill('sOutgoing',social.outgoing.map(r=>personRow(r.name,r.email,
      btn('Cancel','ghost',async()=>{ await api.removeConnect(r.connectionId); await refreshSocial(true); }))));
    fill('sFriends',social.friends.map(friendRow),'No connections yet. Find someone by email above.');
    renderGroups();
  }
  function friendRow(f){
    const bits=[f.goals.length===1?'1 shared goal':f.goals.length+' shared goals',awayText(f)];
    if(f.mentorsMe) bits.push('🎓 your mentor');
    if(f.iMentor) bits.push('you mentor them');
    const wrap=el('div','fwrap');
    wrap.append(personRow(f.user.name,bits.join(' · '),
      btn('Visit','',async()=>{ closeSocial(); flyToSystem(systems.get(f.user.id)); }),
      confirmBtn('Remove',async()=>{ await api.removeConnect(f.connectionId); await refreshSocial(true); })));
    const ctl=el('div','fctl');
    const sel=el('select'); sel.title='Group';
    sel.append(Object.assign(el('option',null,'No group'),{value:''}));
    for(const g of social.groups){ const o=el('option',null,g.name); o.value=g.id; sel.append(o); }
    sel.value=f.groupId||'';
    sel.addEventListener('change',async()=>{ const r=await api.setFriendGroup(f.user.id,sel.value||null); if(r.error) showToast(r.error); await refreshSocial(true); });
    const mentor=el('button','sbtn ghost mentor'+(f.mentorsMe?' on':''),f.mentorsMe?'🎓 Your mentor ✓':'🎓 Make mentor');
    mentor.title=f.mentorsMe? 'Stop letting them suggest steps for your goals' : 'Let them suggest steps for your goals';
    mentor.addEventListener('click',async()=>{
      mentor.disabled=true;
      const r=await api.setMentor(f.user.id,!f.mentorsMe);
      if(r.error) showToast(r.error); else showToast(f.mentorsMe? `${f.user.name} is no longer your mentor.` : `${f.user.name} can now suggest steps for your goals.`);
      await refreshSocial(true);
    });
    if(social.groups.length) ctl.append(sel);
    ctl.append(mentor);
    wrap.append(ctl);
    return wrap;
  }
  const GROUP_COLORS=['#ff8ad8','#6dffb0','#5de0ff','#ffb648','#b99bff','#ff6b6b'];
  let newGroupColor=GROUP_COLORS[0];
  function renderGroups(){
    const box=$('sGroups'); box.textContent='';
    for(const g of social.groups){
      const count=social.friends.filter(f=>f.groupId===g.id).length;
      const row=personRow(g.name,count===1?'1 person':count+' people',
        btn('Rename','ghost',async()=>{
          const who=row.querySelector('.who'); who.textContent='';
          const inp=el('input'); inp.type='text'; inp.maxLength=40; inp.value=g.name; who.append(inp); inp.focus(); inp.select();
          const save=async()=>{ const v=inp.value.trim(); if(v && v!==g.name){ const r=await api.saveGroup(g.id,{name:v,color:g.color}); if(r.error) showToast(r.error); } await refreshSocial(true); };
          inp.addEventListener('keydown',e=>{ if(e.key==='Enter') save(); else if(e.key==='Escape'){ e.stopPropagation(); renderGroups(); } });
          inp.addEventListener('blur',save);
        }),
        confirmBtn('Delete',async()=>{ await api.deleteGroup(g.id); await refreshSocial(true); }));
      const dot=el('span','mdot'); dot.style.background=g.color; row.prepend(dot);
      box.append(row);
    }
    const add=el('div','srow gadd');
    const inp=el('input'); inp.type='text'; inp.maxLength=40; inp.placeholder='New group, e.g. Family';
    const sw=el('div','swatches');
    for(const c of GROUP_COLORS){
      const b=el('button','sw'+(c===newGroupColor?' on':'')); b.type='button'; b.style.background=c; b.title=c;
      b.addEventListener('click',()=>{ newGroupColor=c; sw.querySelectorAll('.sw').forEach(x=>x.classList.toggle('on',x===b)); });
      sw.append(b);
    }
    const create=async()=>{
      const v=inp.value.trim(); if(!v){ inp.focus(); return; }
      const r=await api.saveGroup(null,{name:v,color:newGroupColor});
      if(r.error){ showToast(r.error); return; }
      await refreshSocial(true);
    };
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); create(); } });
    add.append(inp,btn('Add','',create));
    box.append(add,sw);
  }
  // bring friends' solar systems in line with the latest connections data
  function applySocial(s){
    social=s;
    const keep=new Set(), added=[];
    for(const f of s.friends){
      keep.add(f.user.id);
      let sys=systems.get(f.user.id);
      if(!sys){ sys=makeSystem(f.user.id,f.user.name,false); added.push(sys); }
      sys.connectionId=f.connectionId;
      sys.friend=f;
      if(sys.name!==f.user.name){ sys.name=f.user.name; sys.labelEl.textContent=f.user.name; }
      const changed=JSON.stringify(f.goals)!==JSON.stringify(sys.goals);
      sys.goals=f.goals;
      if(changed && !added.includes(sys)) syncScene('reload',sys);
      if(changed && detailSys===sys && detailOverlay.classList.contains('show')) openDetail(detailId);
    }
    for(const sys of [...systems.values()]) if(!sys.isMe && !keep.has(sys.key)) destroySystem(sys);
    layoutSystems();
    for(const sys of added) syncScene('initial',sys);
    renderFootprints();
    renderSocial();
  }
  async function refreshSocial(force){
    if(disposed || readOnly || (socialBusy && !force)) return;
    socialBusy=true;
    try{ const s=await api.getSocial(); if(!disposed && s) applySocial(s); }
    catch(e){ console.error(e); }
    finally{ socialBusy=false; }
  }
  function openSocial(){
    $('sResult').textContent='';
    socialOverlay.classList.add('show');
    renderSocial();
    refreshSocial();
    setTimeout(()=>$('sEmail').focus(),50);
  }
  function closeSocial(){ socialOverlay.classList.remove('show'); }
  $('socialBtn').addEventListener('click',openSocial);
  $('sX').addEventListener('click',closeSocial);
  socialOverlay.addEventListener('click',e=>{ if(e.target===socialOverlay) closeSocial(); });
  async function findPerson(){
    const email=$('sEmail').value.trim(), out=$('sResult');
    if(!email) return;
    out.textContent='Searching…';
    let r;
    try{ r=await api.findUser(email); }catch(e){ out.textContent="Couldn't search right now. Try again."; return; }
    out.textContent='';
    if(!r.found){ out.append(el('p','sempty','No Goal Galaxy account uses that email.')); return; }
    if(r.state==='self'){ out.append(el('p','sempty',"That's you.")); return; }
    const label={none:'',outgoing:'Request sent, waiting for a reply',incoming:'Wants to connect with you',connected:'Already connected'}[r.state];
    const actions=[];
    if(r.state==='none' || r.state==='incoming'){
      actions.push(btn(r.state==='incoming'?'Accept':'Connect','',async()=>{
        const res=await api.sendConnect(r.user.id);
        if(res.error){ showToast(res.error); return; }
        out.textContent='';
        out.append(personRow(r.user.name,res.state==='connected'?'Connected':'Request sent, waiting for a reply'));
        showToast(res.state==='connected'? `You're now connected with ${r.user.name}.` : `Request sent to ${r.user.name}.`);
        $('sEmail').value='';
        await refreshSocial(true);
      }));
    }else if(r.state==='connected'){
      actions.push(btn('Visit','',async()=>{ closeSocial(); flyToSystem(systems.get(r.user.id)); }));
    }
    out.append(personRow(r.user.name,label,...actions));
  }
  $('sFind').addEventListener('click',findPerson);
  $('sEmail').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); findPerson(); } });

  // =====================================================================
  // MULTIVERSE: one goal shared by up to 5 connected people
  // =====================================================================
  // In the galaxy, each multiverse you're in is a swirling portal near your sun, tethered to the suns of
  // its members. Tapping it warps the camera into a separate scene: the shared planet (one band per
  // milestone, lit in the colour of whoever completed it) and a moon per member that orbits closer the
  // more of the milestones that member has completed.
  const MV_MAX=5;
  let multiverses=initialMultiverses||[], view='galaxy', mvCurrentId=null;
  const presence=new Map();   // multiverse id -> Map(userId -> focus [x,y,z] | null): who is inside right now
  const activeScene=()=> view==='mv'? mvScene : scene;
  const currentMv=()=> multiverses.find(m=>m.id===mvCurrentId) || null;
  const doneCount=mv=>mv.milestones.filter(m=>m.doneAt).length;
  // born = everyone invited has joined (a multiverse of one isn't born yet)
  const isBorn=mv=>mv.members.length>1 && mv.members.every(m=>m.status==='active');
  const MY_COLOR='#ffd27a';   // the creator's colour on the server; yours while casting threads
  const NEB_TEX=[cloudTex(4242),cloudTex(4343)];
  const _t1=new THREE.Vector3(), _t2=new THREE.Vector3(), _t3=new THREE.Vector3();
  const vibrate=p=>{ try{ if(navigator.vibrate) navigator.vibrate(p); }catch(e){} };

  // ---------- threads of light ----------
  // A glowing curve between two moving points. Its middle is a damped spring, so when an end moves
  // quickly the thread swings and wobbles like something real. Light pulses run along it from a to b.
  const THREAD_N=48;
  const threads=[];
  class Thread{
    constructor(colorA,colorB,opts={}){
      this.a=new THREE.Vector3(); this.b=new THREE.Vector3();
      this.c=null; this.cv=new THREE.Vector3();
      this.ca=new THREE.Color(colorA); this.cb=new THREE.Color(colorB);
      this.alpha=0; this.targetAlpha=opts.alpha??1;
      this.stiff=55; this.damp=7; this.sag=1; this.breathe=false;
      this.fx=null; this.flash=-9;
      this.getA=null; this.getB=null;
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(THREAD_N*3),3));
      g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(THREAD_N*3),3));
      this.line=new THREE.Line(g,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
      this.line.frustumCulled=false;
      this.head=glowSprite(this.cb.getHex(),0,opts.head??1.4);
      homeLayer.add(this.line,this.head);
      threads.push(this);
    }
    point(u,out){   // quadratic Bézier a -> c -> b
      const a=this.a, b=this.b, c=this.c, v=1-u;
      return out.set(v*v*a.x+2*v*u*c.x+u*u*b.x, v*v*a.y+2*v*u*c.y+u*u*b.y, v*v*a.z+2*v*u*c.z+u*u*b.z);
    }
    pluck(k=1){ this.cv.addScaledVector(randDir(),16*k); this.cv.y+=8*k; }
    // pull taut and flash (accepting an invitation)
    tighten(){ this.stiff=180; this.damp=14; this.sag=0; this.targetAlpha=1; this.flash=clockNow(); this.pluck(0.6); }
    loosen(){ this.stiff=55; this.damp=7; this.sag=1; this.targetAlpha=0.7; }
    // shrink back into its start, then vanish
    retract(){ this.getB=null; this.fx={type:'retract',t0:clockNow(),dur:0.35}; }
    // a bright pulse runs to the far end and bursts there, then the thread fades
    fire(){ this.breathe=false; this.targetAlpha=1; this.fx={type:'fire',t0:clockNow(),dur:1.3}; }
    // break into sparks
    snap(){
      if(this.c){
        const col=this.ca.clone().lerp(this.cb,0.5);
        for(let i=0;i<(isMobile?40:80);i++) emit(this.point(Math.random(),_t1),randDir().multiplyScalar(0.5+Math.random()*2.5),col,1+Math.random()*0.6,0.5+Math.random()*0.6,0.95);
      }
      this.dispose();
    }
    update(t,dt){
      if(this.getA) this.getA(this.a);
      if(this.getB) this.getB(this.b);
      const len=this.a.distanceTo(this.b);
      const rest=_t1.copy(this.a).add(this.b).multiplyScalar(0.5); rest.y+=len*0.08*this.sag;
      if(!this.c) this.c=rest.clone();
      this.cv.addScaledVector(_t2.copy(rest).sub(this.c),this.stiff*dt).multiplyScalar(Math.max(0,1-this.damp*dt));
      this.c.addScaledVector(this.cv,dt);
      let reach=1, fade=1, pulseAt=-1;
      if(this.fx){
        const k=clamp01((t-this.fx.t0)/this.fx.dur);
        if(this.fx.type==='retract') reach=1-easeInCubic(k);
        else{
          pulseAt=easeInOutCubic(Math.min(1,k/0.55));
          fade=1-THREE.MathUtils.smoothstep(k,0.55,1);
          if(k>=0.55 && !this.fx.burst){ this.fx.burst=true; dustBurst(this.b.clone(),this.cb); }
        }
        if(k>=1){ this.dispose(); return; }
      }
      this.alpha+=(this.targetAlpha-this.alpha)*Math.min(1,dt*6);
      const a=this.alpha*fade*(this.breathe? 0.55+0.45*Math.sin(t*2.4) : 1);
      const flash=Math.exp(-(t-this.flash)*3)*2;
      const pos=this.line.geometry.attributes.position, col=this.line.geometry.attributes.color;
      for(let i=0;i<THREAD_N;i++){
        const u=i/(THREAD_N-1)*reach, P=this.point(u,_t2);
        pos.setXYZ(i,P.x,P.y,P.z);
        let br=0.35+0.65*Math.pow(0.5+0.5*Math.sin(u*len*0.3-t*6),6)+flash;
        if(pulseAt>=0) br+=3*Math.exp(-Math.pow((u-pulseAt)*9,2));
        const k=br*a;
        col.setXYZ(i,(this.ca.r+(this.cb.r-this.ca.r)*u)*k,(this.ca.g+(this.cb.g-this.ca.g)*u)*k,(this.ca.b+(this.cb.b-this.ca.b)*u)*k);
      }
      pos.needsUpdate=true; col.needsUpdate=true;
      this.point(reach,this.head.position);
      this.head.material.opacity=Math.min(1,a*0.9);
      // sparks shed along the thread
      if(!reduceMotion && a>0.3 && Math.random()<dt*(this.breathe?6:22)){
        const u=Math.random()*reach, c=this.ca.clone().lerp(this.cb,u);
        emit(this.point(u,_t2),randDir().multiplyScalar(0.4+Math.random()*0.8),c,0.8+Math.random()*0.6,0.4+Math.random()*0.4,0.96);
      }
    }
    dispose(){
      if(this.disposed) return;
      this.disposed=true;
      homeLayer.remove(this.line,this.head);
      this.line.geometry.dispose(); this.line.material.dispose(); this.head.material.dispose();
      const i=threads.indexOf(this); if(i>=0) threads.splice(i,1);
    }
  }

  // ---------- portals in the galaxy ----------
  const PORTAL_GEO=new THREE.PlaneGeometry(1,1);
  const PORTAL_VS=`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const PORTAL_FS=`
    uniform float uTime; uniform float uDim; uniform vec3 uA; uniform vec3 uB; varying vec2 vUv;
    void main(){
      vec2 p=vUv*2.0-1.0; float r=length(p); if(r>1.0) discard;
      float a=atan(p.y,p.x);
      float s1=sin(a*3.0+r*14.0-uTime*2.2)*0.5+0.5;
      float s2=sin(a*5.0-r*9.0+uTime*1.3)*0.5+0.5;
      float ring=smoothstep(1.0,0.7,r)*smoothstep(0.1,0.5,r);
      vec3 col=mix(uA,uB,s1)*(0.6+0.7*s2);
      float core=smoothstep(0.42,0.0,r);
      float alpha=clamp(ring*(0.45+0.55*s1)+core,0.0,1.0)*smoothstep(1.0,0.85,r)*uDim;
      gl_FragColor=vec4(mix(col,vec3(0.01,0.0,0.04),core),alpha);
    }`;
  const portals=new Map();   // multiverse id -> portal
  function makePortal(mv){
    const p={id:mv.id,group:new THREE.Group()};
    p.mat=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uDim:{value:1},uA:{value:new THREE.Color(0.62,0.38,1.0)},uB:{value:new THREE.Color(0.25,0.85,1.0)}},
      vertexShader:PORTAL_VS,fragmentShader:PORTAL_FS,transparent:true,depthWrite:false,side:THREE.DoubleSide});
    p.disc=new THREE.Mesh(PORTAL_GEO,p.mat); p.disc.scale.setScalar(8);
    p.halo=glowSprite(0x9a7bff,0.45,15);
    // once everyone has joined, a faint nebula in the members' colours hangs around the portal
    p.neb=[0,1].map(i=>{
      const s=new THREE.Sprite(new THREE.SpriteMaterial({map:NEB_TEX[i],transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
      s.scale.setScalar(26+i*8); s.material.rotation=i*2.1; return s;
    });
    p.nebK=0; p.scaleK=1; p.gather=0;
    // a completed multiverse becomes a star high in your sky (starK: portal 0 -> star 1; riseK: moving up)
    p.starSpr=new THREE.Sprite(new THREE.SpriteMaterial({map:STAR_TEX,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
    p.starGlow=glowSprite(0xfff2d8,0,12);
    p.starK=0; p.riseK=0; p.sky=null; p.starColor=new THREE.Color(1,0.95,0.85);
    p.group.add(...p.neb,p.halo,p.disc,p.starGlow,p.starSpr);
    p.hit=new THREE.Mesh(SPHERE,HIT_MAT); p.hit.scale.setScalar(4.5); p.hit.userData.mv=mv.id; p.group.add(p.hit);
    hitMeshes.push(p.hit);
    p.labelEl=el('div','portallbl'); p.label=new CSS2DObject(p.labelEl); p.label.center.set(0.5,0); p.group.add(p.label);
    const tg=new THREE.BufferGeometry();
    tg.setAttribute('position',new THREE.BufferAttribute(new Float32Array(MV_MAX*6),3));
    tg.setAttribute('color',new THREE.BufferAttribute(new Float32Array(MV_MAX*6),3));
    p.tethers=new THREE.LineSegments(tg,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:0.55,
      blending:THREE.AdditiveBlending,depthWrite:false}));
    p.tethers.frustumCulled=false;
    homeLayer.add(p.group,p.tethers);
    portals.set(mv.id,p);
    return p;
  }
  function destroyPortal(p){
    const i=hitMeshes.indexOf(p.hit); if(i>=0) hitMeshes.splice(i,1);
    p.labelEl.remove();
    if(p.inviteThread) p.inviteThread.dispose();
    homeLayer.remove(p.group,p.tethers);
    p.mat.dispose(); p.halo.material.dispose(); p.neb.forEach(s=>s.material.dispose());
    p.starSpr.material.dispose(); p.starGlow.material.dispose();
    p.tethers.geometry.dispose(); p.tethers.material.dispose();
    portals.delete(p.id);
  }
  const PORTAL_A=new THREE.Color(0.62,0.38,1.0), PORTAL_B=new THREE.Color(0.25,0.85,1.0);
  // a four-pointed flare for completed multiverses
  const STAR_TEX=canvasTex(128,(g,s)=>{
    const c=s/2, gr=g.createRadialGradient(c,c,0,c,c,c*0.5);
    gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(0.25,'rgba(255,255,255,.5)'); gr.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle=gr; g.fillRect(0,0,s,s);
    for(const [w,h] of [[s,3],[3,s],[s*0.55,1.5],[1.5,s*0.55]]){
      const lg=w>h? g.createLinearGradient(-w/2,0,w/2,0) : g.createLinearGradient(0,-h/2,0,h/2);
      lg.addColorStop(0,'rgba(255,255,255,0)'); lg.addColorStop(0.5,'rgba(255,255,255,.9)'); lg.addColorStop(1,'rgba(255,255,255,0)');
      g.save(); g.translate(c,c); if(w<s && h<s) g.rotate(Math.PI/4); g.fillStyle=lg; g.fillRect(-w/2,-h/2,w,h); g.restore();
    }
  });
  // your constellation: completed multiverses in the order they were finished, joined by faint lines
  const constel=new THREE.LineSegments(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({color:0xcdbaff,transparent:true,opacity:0.3,blending:THREE.AdditiveBlending,depthWrite:false}));
  constel.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6*64),3));
  constel.frustumCulled=false;
  homeLayer.add(constel);
  function skySlot(j){
    const a=Math.PI*0.85+j*0.5, R=98+(j%3)*10;
    return new THREE.Vector3(R*Math.sin(a),44+((j*7)%3)*7,-R*Math.cos(a));
  }
  const othersInside=mvId=>{ const h=presence.get(mvId); return h? [...h.keys()].filter(id=>id!==myId) : []; };
  function portalLabel(p,mv){
    p.labelEl.className='portallbl'+(p.invite?' invite':'')+(p.completed?' star':'');
    p.labelEl.textContent=(p.completed?'★ ':'🌀 ')+mv.goal.name;
    const n=mv.milestones.length;
    let sub= p.invite? 'invitation from '+mv.creator.name+' · hold to join'
      : p.completed? 'completed together · '+new Date(mv.completedAt).toLocaleDateString()
      : (n? doneCount(mv)+'/'+n+' milestones · '+STAGES[stageFor(mv)] : mv.members.length+' people');
    const inside=othersInside(mv.id).map(id=>{ const m=mv.members.find(x=>x.userId===id); return m? m.name : null; }).filter(Boolean);
    if(inside.length && !p.invite) sub+=' · ● '+inside.join(', ')+' inside';
    p.labelEl.append(el('span','sub',sub));
  }
  function updatePortal(p,mv,i){
    // a ring of portal slots between your rings and your connections' systems
    const a=Math.PI*1.15+i*0.62, R=62+Math.floor(i/10)*14;
    p.base=new THREE.Vector3(R*Math.sin(a),5,-R*Math.cos(a));
    p.invite=mv.myStatus!=='active';
    p.completed=!!mv.completedAt && !p.invite;
    p.born=isBorn(mv);
    p.mat.uniforms.uDim.value=p.invite?0.45:1;
    // a born multiverse swirls in its members' colours
    const cols=mv.members.map(m=>new THREE.Color(m.color));
    p.mat.uniforms.uA.value.copy(p.born? cols[0] : PORTAL_A);
    p.mat.uniforms.uB.value.copy(p.born? cols[1] : PORTAL_B);
    p.neb.forEach((s,j)=>s.material.color.copy(p.born? cols[j%cols.length] : PORTAL_A));
    // the star is white-gold, tinted by everyone's colours
    p.starColor.setRGB(1,1,1); cols.forEach(c=>p.starColor.lerp(c,0.5/cols.length));
    p.starSpr.material.color.copy(p.starColor); p.starGlow.material.color.copy(p.starColor);
    portalLabel(p,mv);
    p.members=mv.members.filter(m=>m.status==='active').map(m=>({userId:m.userId,color:new THREE.Color(m.color)}));
    // an invitation is a faint thread pulsing from the portal toward your sun
    if(p.invite && !p.inviteThread){
      const th=new Thread('#b99bff',MY_COLOR,{alpha:0.7,head:1.1});
      th.getA=o=>o.copy(p.group.position); th.getB=o=>o.copy(me.offset); th.breathe=true;
      p.inviteThread=th;
    }else if(!p.invite && p.inviteThread){ p.inviteThread.fire(); p.inviteThread=null; }
  }
  function updatePortals(t,dt){
    const stars=[];
    for(const p of portals.values()){
      const playing=bang && bang.p===p;
      // once its supernova has been seen, a completed multiverse is a star (the supernova itself drives this)
      if(!playing){
        const want=(p.completed && p.sky && novaSeen.has(p.id))?1:0;
        p.starK+=(want-p.starK)*Math.min(1,dt*1.5);
        p.riseK+=(want-p.riseK)*Math.min(1,dt*0.8);
      }
      const sk=p.starK;
      p.mat.uniforms.uTime.value=t;
      p.group.position.copy(p.base);
      if(p.sky && p.riseK>0.001) p.group.position.lerp(p.sky,easeInOutCubic(clamp01(p.riseK)));
      p.group.position.y+=Math.sin(t*0.6+p.base.x)*0.6*(1-sk);
      p.disc.quaternion.copy(camera.quaternion);
      p.disc.scale.setScalar(Math.max(8*p.scaleK*(1-sk),0.0001)); p.halo.scale.setScalar(Math.max(15*p.scaleK*(1-sk),0.0001));
      p.disc.visible=sk<0.99; p.halo.visible=sk<0.99;
      const tw=1+0.08*Math.sin(t*2.3+p.base.x)+0.05*Math.sin(t*5.1+p.base.z);
      p.starSpr.material.opacity=sk; p.starSpr.scale.setScalar(Math.max(18*sk*tw,0.0001)); p.starSpr.material.rotation=t*0.05;
      p.starGlow.material.opacity=0.55*sk; p.starGlow.scale.setScalar(Math.max(14*sk*tw,0.0001));
      if(sk>0.9) stars.push(p);
      p.label.position.copy(camDown).multiplyScalar(5.2);
      p.labelEl.style.opacity= playing? 0 : 1;
      p.nebK+=((p.born && !playing?1:0)*(1-sk)-p.nebK)*Math.min(1,dt*0.8);
      p.neb.forEach((s,j)=>{ s.material.opacity=p.nebK*(0.13-j*0.04); s.material.rotation+=dt*(j?-0.03:0.02); });
      if(sk>0.5){ p.tethers.geometry.setDrawRange(0,0); continue; }   // stars aren't tethered
      // a line from each member's sun (yours, or a connection's system) to the portal;
      // during the big bang the lines are pulled in toward the portal
      const pos=p.tethers.geometry.attributes.position, col=p.tethers.geometry.attributes.color;
      let k=0;
      for(const m of p.members){
        // your sun, or the member's sun-gate
        if((m.userId!==myId && !gates.has(m.userId)) || k>=MV_MAX) continue;
        _t3.copy(m.userId===myId? me.offset : gatePos(m.userId)).lerp(p.group.position,p.gather);
        pos.setXYZ(k*2,_t3.x,_t3.y,_t3.z);
        pos.setXYZ(k*2+1,p.group.position.x,p.group.position.y,p.group.position.z);
        col.setXYZ(k*2,m.color.r*0.25,m.color.g*0.25,m.color.b*0.25); col.setXYZ(k*2+1,m.color.r,m.color.g,m.color.b);
        k++;
      }
      for(let j=k;j<MV_MAX;j++){ pos.setXYZ(j*2,0,0,0); pos.setXYZ(j*2+1,0,0,0); }
      p.tethers.geometry.setDrawRange(0,k*2);
      pos.needsUpdate=true; col.needsUpdate=true;
    }
    // constellation lines between stars, in the order they were completed
    stars.sort((a,b)=>a.starOrder-b.starOrder);
    const cp=constel.geometry.attributes.position;
    let n=0;
    for(let i=1;i<stars.length && n<64;i++,n++){
      const a=stars[i-1].group.position, b=stars[i].group.position;
      cp.setXYZ(n*2,a.x,a.y,a.z); cp.setXYZ(n*2+1,b.x,b.y,b.z);
    }
    constel.geometry.setDrawRange(0,n*2);
    cp.needsUpdate=true;
  }

  // ---------- data ----------
  function applyMultiverses(list){
    const prev=multiverses;
    multiverses=list;
    const ids=new Set(list.map(m=>m.id));
    for(const p of [...portals.values()]) if(!ids.has(p.id)) destroyPortal(p);
    list.forEach((mv,i)=>updatePortal(portals.get(mv.id)||makePortal(mv),mv,i));
    // completed multiverses get a place in your constellation, in the order they were finished
    list.filter(m=>m.completedAt && m.myStatus==='active').sort((a,b)=>a.completedAt.localeCompare(b.completedAt))
      .forEach((mv,j)=>{ const p=portals.get(mv.id); p.sky=skySlot(j); p.starOrder=j; });
    // big bangs and supernovas each member hasn't seen yet play once (on this device); ones announced live
    // are already scheduled to play in sync
    const pending=(kind,id)=> scheduled.some(s=>s.kind===kind && s.id===id) || cineQueue.some(q=>q.kind===kind && q.id===id) || (bang && bang.kind===kind && bang.id===id);
    for(const mv of list){
      if(mv.myStatus!=='active') continue;
      if(isBorn(mv) && !bornSeen.has(mv.id) && !pending('bang',mv.id)) cineQueue.push({kind:'bang',id:mv.id});
      if(mv.completedAt && !novaSeen.has(mv.id) && !pending('nova',mv.id)) cineQueue.push({kind:'nova',id:mv.id});
    }
    renderMvBadge();
    updateAllBtn();
    if(mvOverlay.classList.contains('show')) renderMvList();
    if(view==='mv'){
      const cur=currentMv();
      if(!cur || cur.myStatus!=='active'){ showToast("You're no longer part of that multiverse."); exitMultiverse(); }
      else syncMvScene(cur,prev.find(m=>m.id===cur.id));
    }
  }
  // Loads run one after another so an older response never overwrites a newer one. A forced refresh
  // always gets its own load (awaiting it means the data is fresh); a background one joins any queued.
  let mvChain=Promise.resolve(), mvQueued=0;
  function refreshMultiverses(force){
    if(disposed) return Promise.resolve();
    if(mvQueued>0 && !force) return mvChain;
    mvQueued++;
    mvChain=mvChain.then(async()=>{
      try{ const list=await api.getMultiverses(); if(!disposed && Array.isArray(list)) applyMultiverses(list); }
      catch(e){ console.error(e); }
      finally{ mvQueued--; }
    });
    return mvChain;
  }
  function renderMvBadge(){
    const n=multiverses.filter(m=>m.myStatus!=='active').length
      + multiverses.filter(m=>m.isCreator).reduce((s,m)=>s+m.pending.length,0);
    const b=$('mvBadge'); b.textContent=n>9?'9+':String(n); b.classList.toggle('show',n>0);
  }

  // ---------- list + create ----------
  const mvOverlay=$('mvOverlay'), mcOverlay=$('mvCreateOverlay');
  function renderMvList(){
    const invites=multiverses.filter(m=>m.myStatus!=='active'), mine=multiverses.filter(m=>m.myStatus==='active');
    $('mvInvitesSec').classList.toggle('hide',!invites.length);
    fill('mvInvites',invites.map(mv=>personRow(mv.goal.name,'from '+mv.creator.name+' · '+mv.members.length+' people',
      btn('Join','',async()=>{ closeMvList(); await acceptInvite(mv.id); }),
      btn('Decline','ghost',async()=>{ await api.respondMvInvite(mv.id,false); await refreshMultiverses(true); }))));
    fill('mvList',mine.map(mv=>{
      const n=mv.milestones.length, wait=mv.isCreator? mv.pending.length : 0;
      const sub=mv.members.filter(m=>m.status==='active').length+' people'+(n?' · '+doneCount(mv)+'/'+n+' milestones':'')+(wait?' · '+wait+' to approve':'');
      return personRow('🌀 '+mv.goal.name,sub,btn('Enter','',async()=>{ closeMvList(); enterMultiverse(mv.id); }));
    }),'None yet. Hold your sun and drag to a friend\'s sun, or create one below.');
  }
  function openMvList(){ renderMvList(); mvOverlay.classList.add('show'); refreshMultiverses(); }
  function closeMvList(){ mvOverlay.classList.remove('show'); }
  $('mvBtn').addEventListener('click',openMvList);
  $('mvX').addEventListener('click',closeMvList);
  mvOverlay.addEventListener('click',e=>{ if(e.target===mvOverlay) closeMvList(); });

  let mcImportance='medium';
  function msInputRow(value){
    const row=el('div','msrow'), inp=el('input'); inp.type='text'; inp.maxLength=200; inp.placeholder='e.g. First 10k run'; inp.value=value||'';
    const x=el('button',null,'×'); x.type='button'; x.title='Remove';
    x.addEventListener('click',()=>{ row.remove(); if(!$('mcMilestones').children.length) $('mcMilestones').append(msInputRow()); });
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); const r=msInputRow(); row.after(r); r.querySelector('input').focus(); } });
    row.append(inp,x);
    return row;
  }
  function renderInvitePicker(preselect=[]){
    const box=$('mcInvite'); box.textContent='';
    if(!social.friends.length){ box.append(el('p','sempty','Connect with people first (👥 Connections), then invite them here.')); }
    for(const f of social.friends){
      const lab=el('label','pick'), cb=el('input'); cb.type='checkbox'; cb.value=f.user.id; cb.checked=preselect.includes(f.user.id);
      cb.addEventListener('change',updateInviteCount);
      lab.append(cb,document.createTextNode(f.user.name));
      box.append(lab);
    }
    updateInviteCount();
  }
  function updateInviteCount(){
    const boxes=[...$('mcInvite').querySelectorAll('input')], n=boxes.filter(b=>b.checked).length;
    boxes.forEach(b=>{ b.disabled=!b.checked && n>=MV_MAX-1; });
    $('mcInviteCount').textContent=n? n+' of '+(MV_MAX-1)+' chosen' : 'up to '+(MV_MAX-1)+' connections';
  }
  // preselect: friends already chosen by casting threads to their suns
  function openMvCreate(preselect=[]){
    closeMvList();
    $('mcName').value=''; $('mcCategory').value=''; $('mcDate').value=todayISO(); $('mcHint').textContent='';
    $('mcName').classList.remove('err');
    mcImportance='medium'; setSeg('mcImp',mcImportance);
    const ms=$('mcMilestones'); ms.textContent=''; ms.append(msInputRow(),msInputRow());
    renderInvitePicker(preselect);
    mcOverlay.classList.add('show');
    setTimeout(()=>$('mcName').focus(),50);
  }
  // cast threads wait while the form is open: they fire toward the invitees on create, or snap on cancel
  function closeMvCreate(created=false){
    mcOverlay.classList.remove('show');
    if(castThreads){ castThreads.forEach(th=> created? th.fire() : th.snap()); castThreads=null; }
  }
  $('mvNewBtn').addEventListener('click',()=>openMvCreate());
  $('mcX').addEventListener('click',()=>closeMvCreate());
  $('mcCancel').addEventListener('click',()=>closeMvCreate());
  $('mcAddMs').addEventListener('click',()=>{ const r=msInputRow(); $('mcMilestones').append(r); r.querySelector('input').focus(); });
  $('mcImp').addEventListener('click',e=>{ if(e.target.tagName!=='BUTTON') return; mcImportance=e.target.dataset.v; setSeg('mcImp',mcImportance); });
  $('mcName').addEventListener('input',()=>$('mcName').classList.remove('err'));
  $('mcCreate').addEventListener('click',async()=>{
    const b=$('mcCreate'); if(b.disabled) return;
    const name=$('mcName').value.trim();
    if(!name){ $('mcName').classList.add('err'); $('mcName').focus(); return; }
    const milestones=[...$('mcMilestones').querySelectorAll('input')].map(i=>i.value.trim()).filter(Boolean);
    const inviteIds=[...$('mcInvite').querySelectorAll('input:checked')].map(i=>i.value);
    b.disabled=true; $('mcHint').textContent='';
    try{
      const res=await api.createMultiverse({goal:{name,category:$('mcCategory').value.trim(),importance:mcImportance,
        date:normalizeDate($('mcDate').value)||todayISO()},milestones,inviteIds});
      if(res.error){ $('mcHint').textContent=res.error; return; }
      closeMvCreate(true);
      await refreshMultiverses(true);
      const p=portals.get(res.id);
      if(p) shockwave(p.group.position.clone(),new THREE.Color(0.7,0.5,1),clockNow());
      if(inviteIds.length){
        // stay in the galaxy to watch the invitations go out; the big bang comes when the last one joins
        showToast('Multiverse created. It will be born when everyone you invited joins.',{label:'Enter',action:()=>enterMultiverse(res.id),timeout:7000});
        setTimeout(()=>flyToPortal(res.id),reduceMotion?0:900);
      }else{
        showToast('Multiverse created. Invite people from inside it.');
        setTimeout(()=>enterMultiverse(res.id),reduceMotion?0:700);
      }
    }catch(e){ console.error(e); $('mcHint').textContent="Couldn't create it right now. Try again."; }
    finally{ b.disabled=false; }
  });

  function flyToPortal(id){
    if(visitSys){ exitVisit(()=>flyToPortal(id)); return; }
    const p=portals.get(id); if(!p || view!=='galaxy') return;
    savedView=null;
    const P=p.base, dir=_t1.copy(camera.position).sub(P).setY(0);
    if(dir.lengthSq()<1e-6) dir.set(0,0,1);
    dir.normalize();
    flyTo(P.clone().addScaledVector(dir,30).add(new THREE.Vector3(0,16,0)),P.clone(),1.4);
  }

  // ---------- gestures ----------
  // Hold your sun, then drag: a thread of light follows your finger and hooks onto every friend's sun it
  // touches. Let go to name the shared goal. Holding an invitation's portal fills a ring; when it's full
  // you've joined.
  const HOLD_CAST=0.35, HOLD_ACCEPT=1.1;
  const holdRing=$('holdRing'), holdArc=holdRing.querySelector('.arc');
  let hold=null, cast=null, castThreads=null, gestureUsed=false, gestureLock=false;
  const anyOverlay=()=>[formOverlay,detailOverlay,socialOverlay,mvOverlay,mcOverlay].some(o=>o.classList.contains('show'));
  function beginHold(x,y){
    if(view!=='galaxy' || visitSys || readOnly || camTween || bang || cast || anyOverlay()) return;
    const hit=pickAt(x,y);
    if(hit && hit.sys==='me') hold={kind:'cast',x,y,t0:clockNow(),dur:HOLD_CAST,color:MY_COLOR,showAt:0.08};
    else if(hit && hit.mv){
      const mv=multiverses.find(m=>m.id===hit.mv);
      if(mv && mv.myStatus!=='active') hold={kind:'accept',id:mv.id,x,y,t0:clockNow(),dur:HOLD_ACCEPT,color:'#c9a8ff',showAt:0.15};
    }
    if(hold){ holdRing.style.transform=`translate(${x}px,${y}px)`; holdArc.style.stroke=hold.color; holdRing.style.color=hold.color; holdArc.style.strokeDashoffset='138.2'; }
  }
  function cancelHold(){ hold=null; holdRing.classList.remove('show'); }
  function stepHold(t){
    if(!hold) return;
    const e=t-hold.t0, k=clamp01(e/hold.dur);
    if(e>=hold.showAt) holdRing.classList.add('show');
    holdArc.style.strokeDashoffset=String(138.2*(1-k));
    if(k<1) return;
    const h=hold; cancelHold(); gestureUsed=true;
    if(h.kind==='cast') startCast(h.x,h.y);
    else acceptInvite(h.id,true);
  }
  addEventListener('pointermove',e=>{
    if(hold && Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>10) cancelHold();   // it's a drag, not a hold
    if(cast && e.isPrimary){ cast.x=e.clientX; cast.y=e.clientY; }
  },{signal});
  const pointerEnd=e=>{ if(!e.isPrimary) return; cancelHold(); if(cast) endCast(false); };
  addEventListener('pointerup',pointerEnd,{signal});
  addEventListener('pointercancel',pointerEnd,{signal});
  function castHint(text){ const h=$('castHint'); if(text){ h.textContent=text; h.classList.add('show'); } else h.classList.remove('show'); }

  const GROUND=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  function toScreen(v){
    const p=_t2.copy(v).project(camera);
    if(p.z>1) return null;
    const r=canvas.getBoundingClientRect();
    return {x:r.left+(p.x+1)/2*r.width, y:r.top+(1-p.y)/2*r.height};
  }
  function startCast(x,y){
    if(!social.friends.length){ showToast('Connect with someone first (👥 Connections), then hold your sun and drag to theirs.'); return; }
    gestureLock=true; controls.enabled=false;
    const live=new Thread(MY_COLOR,'#ffffff',{head:1.8});
    cast={x,y,ptr:me.offset.clone(),hooked:[],live,warned:false};
    live.getA=o=>o.copy(me.offset); live.getB=o=>o.copy(cast? cast.ptr : o); live.stiff=40; live.damp=5;
    vibrate(15);
    castHint("Drag to a friend's rift");
    // every friend's sun has to be on screen to reach it
    const off=[...gates.values()].some(g=>{ const p=toScreen(g.group.position); return !p || p.x<20 || p.y<20 || p.x>innerWidth-20 || p.y>innerHeight-20; });
    if(off) flyOverview();
  }
  function updateCast(){
    if(!cast) return;
    const r=canvas.getBoundingClientRect();
    ndc.set(((cast.x-r.left)/r.width)*2-1,-((cast.y-r.top)/r.height)*2+1);
    raycaster.setFromCamera(ndc,camera);
    // snap to a friend's sun-gate under the finger, else follow it across the galaxy plane
    let snap=null, best=Math.max(44,isMobile?56:0);
    for(const s of systems.values()){
      if(s.isMe) continue;
      const p=toScreen(gatePos(s.key)); if(!p) continue;
      const d=Math.hypot(p.x-cast.x,p.y-cast.y);
      if(d<best){ best=d; snap=s; }
    }
    if(snap){ cast.ptr.copy(gatePos(snap.key)); hookFriend(snap); }
    else if(raycaster.ray.intersectPlane(GROUND,_t3)) cast.ptr.copy(_t3);
    else cast.ptr.copy(raycaster.ray.at(camera.position.distanceTo(controls.target),_t3));
  }
  function hookFriend(s){
    if(cast.hooked.some(h=>h.sys===s)) return;
    if(cast.hooked.length>=MV_MAX-1){
      if(!cast.warned){ cast.warned=true; showToast(`A multiverse holds ${MV_MAX} people, you included.`); }
      return;
    }
    const th=new Thread(MY_COLOR,'#a9b8ff',{});
    th.getA=o=>o.copy(me.offset); th.getB=o=>o.copy(gatePos(s.key));
    if(cast.live.c){ th.c=cast.live.c.clone(); th.cv.copy(cast.live.cv); }
    th.alpha=1; th.pluck(1.3);
    cast.hooked.push({sys:s,thread:th});
    vibrate(25);
    dustBurst(gatePos(s.key).clone(),new THREE.Color(MY_COLOR));
    shockwave(gatePos(s.key).clone(),new THREE.Color(MY_COLOR),clockNow(),7,0.8);
    const names=cast.hooked.map(h=>h.sys.name).join(', ');
    castHint(cast.hooked.length>=MV_MAX-1? `${names} · let go` : `${names} · drag to more friends, or let go`);
  }
  function endCast(cancelled){
    const c=cast; cast=null; gestureLock=false; controls.enabled=!camTween;
    castHint(null);
    c.live.retract();
    if(!c.hooked.length) return;
    if(cancelled){ c.hooked.forEach(h=>h.thread.snap()); return; }
    castThreads=c.hooked.map(h=>h.thread);
    openMvCreate(c.hooked.map(h=>h.sys.key));
  }

  // joining: from the hold gesture or the Join button in the list
  async function acceptInvite(id,viaHold=false){
    const mv=multiverses.find(m=>m.id===id); if(!mv || mv.myStatus==='active') return;
    const p=portals.get(id), th=p && p.inviteThread;
    if(th) th.tighten();
    vibrate(viaHold? [20,40,60] : 20);
    if(!viaHold) flyToPortal(id);
    let r;
    try{ r=await api.respondMvInvite(id,true); }catch(e){ console.error(e); r={error:"Couldn't join right now. Check your connection and try again."}; }
    if(r.error){ showToast(r.error); if(th && !th.disposed) th.loosen(); return; }
    // you were the last one: the big bang starts at the same moment for everyone online
    if(r.bornAt) schedule('bang',id,r.bornAt);
    if(p && !reduceMotion) shockwave(p.base.clone(),new THREE.Color(MY_COLOR),clockNow(),9,1);
    await refreshMultiverses(true);
    const now=multiverses.find(m=>m.id===id);
    if(now && !isBorn(now)){
      const waiting=now.members.filter(m=>m.status!=='active').map(m=>m.name);
      showToast(`You joined "${now.goal.name}". It's born when ${waiting.join(', ')} ${waiting.length===1?'joins':'join'}.`,
        {label:'Enter',action:()=>enterMultiverse(id),timeout:7000});
    }
  }

  // ---------- cinematics: the big bang and the supernova ----------
  // Each plays once per member per device. When the server announces one live (born / nova events), every
  // open tab starts it at the same server time; otherwise it waits in a queue until the galaxy is free.
  const seenSet=key=>{ try{ return new Set(JSON.parse(localStorage.getItem(key)||'[]')); }catch(e){ return new Set(); } };
  const BORN_KEY='goalGalaxyBorn:'+myId, NOVA_KEY='goalGalaxyNova:'+myId;
  const bornSeen=seenSet(BORN_KEY), novaSeen=seenSet(NOVA_KEY);
  function markSeen(set,key,id){
    set.add(id);
    try{ localStorage.setItem(key,JSON.stringify([...set].slice(-200))); }catch(e){}
  }
  let bang=null, timeScale=1;   // bang: the cinematic playing now, of any kind
  const scheduled=[];   // announced live: {kind:'bang'|'nova', id, t: clock time to start}
  const cineQueue=[];   // waiting for a free moment: {kind, id}
  const EXPOSURE=renderer.toneMappingExposure;
  function schedule(kind,id,serverAt){
    if((kind==='bang'? bornSeen : novaSeen).has(id)) return;
    if(bang && bang.id===id && (bang.kind===kind || (kind==='nova' && bang.kind==='mvnova'))) return;
    for(let i=cineQueue.length-1;i>=0;i--) if(cineQueue[i].kind===kind && cineQueue[i].id===id) cineQueue.splice(i,1);
    if(scheduled.some(s=>s.kind===kind && s.id===id)) return;
    scheduled.push({kind,id,t:serverToClock(serverAt)});
  }
  function readyFor(kind,id){
    const mv=multiverses.find(m=>m.id===id);
    if(!mv || !portals.has(id) || mv.myStatus!=='active') return false;
    return kind==='bang'? isBorn(mv) : !!mv.completedAt;
  }
  // a live cinematic may interrupt the camera and close the multiverse list, but never a form you're typing in
  function canPlayLive(s){
    if(!readyFor(s.kind,s.id) || warp || cast) return false;
    if(s.kind==='nova' && view==='mv' && mvCurrentId===s.id) return true;
    if(view!=='galaxy' || visitSys) return false;
    if(mvOverlay.classList.contains('show')) closeMvList();
    if(detailOverlay.classList.contains('show')) closeDetail(false);
    return !anyOverlay();
  }
  function play(kind,id){
    if(kind==='bang') startBang(id);
    else if(view==='mv' && mvCurrentId===id) startMvNova(id);
    else startNova(id);
  }
  function nextBang(){
    const t=clockNow();
    for(let i=scheduled.length-1;i>=0;i--){
      const s=scheduled[i];
      if(t<s.t) continue;
      if(!bang && canPlayLive(s)){ scheduled.splice(i,1); play(s.kind,s.id); continue; }
      if(t>s.t+6){ scheduled.splice(i,1); cineQueue.push({kind:s.kind,id:s.id}); }   // missed it: play later
    }
    if(bang || !cineQueue.length || camTween || cast || hold || warp || anyOverlay() || view!=='galaxy' || visitSys) return;
    const q=cineQueue.shift();
    if(readyFor(q.kind,q.id)) play(q.kind,q.id);
  }
  function lockForCinematic(){ gestureLock=true; controls.enabled=false; savedView=null; }
  function flyToFace(P,dist,up,dur,done){
    const dir=_t1.copy(camera.position).sub(P).setY(0);
    if(dir.lengthSq()<1e-6) dir.set(0,0,1);
    dir.normalize();
    flyTo(P.clone().addScaledVector(dir,dist).add(new THREE.Vector3(0,up,0)),P.clone(),dur,done);
  }
  function bornToast(mv){
    showToast(`🌌 "${mv.goal.name}" is born. Everyone's in.`,{label:'Enter',action:()=>enterMultiverse(mv.id),timeout:8000});
  }
  function novaToast(mv){
    showToast(`🌟 You finished "${mv.goal.name}" together! It's now a star in your sky.`,{label:'See it',action:()=>{ if(view==='mv') exitMultiverse(); else flyToPortal(mv.id); },timeout:9000});
  }
  // particles streaming into a point from all around
  function inflow(P,colors,n,rMin,rSpan,life){
    for(let i=0;i<n;i++){
      const d=randDir().clone(), r=rMin+Math.random()*rSpan;
      emit(_t1.copy(P).addScaledVector(d,r),d.multiplyScalar(-r/life),colors[(Math.random()*colors.length)|0],1+Math.random(),life,1);
    }
  }
  function outburst(P,colors,n,vMin,vSpan,drag){
    const white=new THREE.Color(1,1,1);
    for(let i=0;i<n;i++) emit(P,randDir().multiplyScalar(vMin+Math.random()*vSpan),Math.random()<0.2? white : colors[i%colors.length],1.2+Math.random()*1.8,1.2+Math.random()*1.8,drag);
  }
  function flash(k){ $('bangFlash').style.opacity=String(Math.max(0,k)); }

  // ---------- the big bang ----------
  // When the last invitee joins, the members' threads pull together into the portal, the galaxy slows and
  // dims, everything collapses to a point, and a shockwave blooms into a nebula in all the members' colours.
  const BANG_GATHER=1.3, BANG_BOOM=1.65, BANG_END=5.4;
  function startBang(id){
    const mv=multiverses.find(m=>m.id===id), p=portals.get(id);
    if(!mv || !p || !isBorn(mv)) return;
    markSeen(bornSeen,BORN_KEY,id);
    if(reduceMotion){ shockwave(p.base.clone(),new THREE.Color(mv.members[0].color),clockNow(),14); bornToast(mv); return; }
    lockForCinematic();
    const core=glowSprite(0xffffff,0,2); core.position.copy(p.base); scene.add(core);
    bang={kind:'bang',id,p,mv,P:p.base.clone(),colors:mv.members.map(m=>new THREE.Color(m.color)),core,neb:[],t0:Infinity,boomed:false};
    flyToFace(p.base,40,22,1.4,()=>{ if(bang) bang.t0=clockNow(); });
  }
  function updateBang(t,dt){
    if(!bang) return;
    if(bang.kind==='mvnova'){ updateMvNova(t,dt); return; }
    if(view!=='galaxy') return;
    const b=bang, p=b.p;
    if(!portals.has(b.id)){ endBang(); return; }   // deleted meanwhile
    if(t<b.t0) return;
    if(b.kind==='nova'){ updateNova(t,dt); return; }
    const e=t-b.t0;
    b.P.copy(p.group.position); b.core.position.copy(b.P);
    if(e<BANG_BOOM){
      // 1. gather: threads contract, dust streams in, time slows, the light drains away
      const g=clamp01(e/BANG_BOOM);
      p.gather=easeInCubic(clamp01(e/BANG_GATHER));
      timeScale=1-0.92*g;
      renderer.toneMappingExposure=EXPOSURE*(1-0.5*g);
      p.scaleK=1-easeInCubic(clamp01((e-0.5)/(BANG_BOOM-0.5)));
      inflow(b.P,b.colors,isMobile?4:8,9,16,0.55);
      // 2. collapse to a single blinding point
      const shrink=clamp01((e-BANG_GATHER)/(BANG_BOOM-BANG_GATHER));
      b.core.material.opacity=Math.min(1,g*1.4);
      b.core.scale.setScalar(e<BANG_GATHER? 2+6*g : THREE.MathUtils.lerp(8,0.6,easeInCubic(shrink)));
      return;
    }
    if(!b.boomed){
      // 3. bang
      b.boomed=true;
      vibrate([40,30,90]); sound.boom();
      renderer.toneMappingExposure=EXPOSURE*1.7;
      p.gather=1; p.scaleK=0;
      b.colors.forEach((c,i)=>shockwave(b.P,c,t+i*0.12,34+i*6,1.9));
      shockwave(b.P,new THREE.Color(1,1,1),t,22,1.2);
      outburst(b.P,b.colors,isMobile?500:1100,8,34,0.955);
      // the nebula of the new pocket universe, one cloud per member
      b.neb=b.colors.map((c,i)=>{
        const s=new THREE.Sprite(new THREE.SpriteMaterial({map:NEB_TEX[i%2],color:c,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
        s.material.rotation=Math.random()*Math.PI*2; s.position.copy(b.P).add(randDir().multiplyScalar(2)); s.scale.setScalar(1);
        scene.add(s); return s;
      });
    }
    // 4. bloom: the nebula spreads, light returns, the portal re-forms in the members' colours
    const k=clamp01((e-BANG_BOOM)/(BANG_END-BANG_BOOM));
    flash(1-(e-BANG_BOOM)/0.6);
    b.core.material.opacity=Math.max(0,1-k*3); b.core.scale.setScalar(30*(1-k*0.5));
    b.neb.forEach((s,i)=>{
      s.scale.setScalar(6+(34+i*6)*easeOutCubic(Math.min(1,k*1.7)));
      s.material.opacity=0.42*easeOutCubic(Math.min(1,k*4))*(1-THREE.MathUtils.smoothstep(k,0.55,1));
      s.material.rotation+=dt*(i%2?-0.12:0.1);
    });
    renderer.toneMappingExposure+=(EXPOSURE-renderer.toneMappingExposure)*Math.min(1,dt*1.5);
    timeScale=Math.min(1,0.08+k*1.4);
    p.scaleK=easeOutBack(clamp01((e-2.4)/0.9));
    p.gather=1-easeOutCubic(clamp01((e-2.6)/1.4));
    if(k>=1){ const mv=multiverses.find(m=>m.id===b.id)||b.mv; endBang(); bornToast(mv); }
  }

  // ---------- the supernova (in the galaxy) ----------
  // The portal swells, bursts in a slow flash, and what's left is a star that rises into your sky.
  const NOVA_SWELL=1.1, NOVA_STAR=3.0, NOVA_END=5.6;
  function startNova(id){
    const mv=multiverses.find(m=>m.id===id), p=portals.get(id);
    if(!mv || !p || !mv.completedAt) return;
    markSeen(novaSeen,NOVA_KEY,id);
    if(reduceMotion){ shockwave(p.base.clone(),p.starColor,clockNow(),16); novaToast(mv); return; }
    lockForCinematic();
    const core=glowSprite(0xffffff,0,2); core.position.copy(p.base); scene.add(core);
    p.starK=0; p.riseK=0;
    bang={kind:'nova',id,p,mv,P:p.base.clone(),colors:mv.members.map(m=>new THREE.Color(m.color)),core,neb:[],t0:Infinity,boomed:false,rising:false};
    flyToFace(p.base,38,18,1.4,()=>{ if(bang) bang.t0=clockNow(); });
  }
  function updateNova(t,dt){
    const b=bang, p=b.p, e=t-b.t0;
    b.P.copy(p.group.position); b.core.position.copy(b.P);
    if(e<NOVA_SWELL){
      const g=clamp01(e/NOVA_SWELL);
      p.scaleK=1+0.7*easeInCubic(g);
      timeScale=1-0.75*g;
      renderer.toneMappingExposure=EXPOSURE*(1+0.3*g);
      b.core.material.opacity=g; b.core.scale.setScalar(4+10*g*g);
      inflow(b.P,b.colors,isMobile?3:6,6,10,0.5);
      return;
    }
    if(!b.boomed){
      b.boomed=true;
      vibrate([60,40,120]); sound.boom();
      renderer.toneMappingExposure=EXPOSURE*1.9;
      shockwave(b.P,new THREE.Color(1,1,1),t,60,3.6);
      b.colors.forEach((c,i)=>shockwave(b.P,c,t+0.15+i*0.15,44+i*5,3.2));
      outburst(b.P,b.colors,isMobile?550:1200,5,26,0.975);
    }
    const k=clamp01((e-NOVA_SWELL)/(NOVA_END-NOVA_SWELL));
    flash(1-(e-NOVA_SWELL)/0.9);
    renderer.toneMappingExposure+=(EXPOSURE-renderer.toneMappingExposure)*Math.min(1,dt*1.2);
    timeScale=Math.min(1,0.2+k*1.2);
    b.core.material.opacity=Math.max(0,1-k*2.5); b.core.scale.setScalar(34*(1-k*0.6));
    p.scaleK=Math.max(0,1.7*(1-k*3));
    p.starK=easeOutCubic(clamp01((e-NOVA_SWELL-0.2)/1.4));
    // then the new star rises to its place in your constellation
    if(e>=NOVA_STAR && p.sky){
      if(!b.rising){ b.rising=true; flyToFace(p.sky,60,14,NOVA_END-NOVA_STAR); }
      p.riseK=easeInOutCubic(clamp01((e-NOVA_STAR)/(NOVA_END-NOVA_STAR-0.3)));
    }
    if(e>=NOVA_END){ const mv=multiverses.find(m=>m.id===b.id)||b.mv; p.starK=1; p.riseK=p.sky?1:0; endBang(); novaToast(mv); }
  }

  // ---------- the supernova (inside, when you're there as it's completed) ----------
  let mvPull=0;   // pulls the moons in while the planet swells
  const MVN_SWELL=1.3, MVN_END=5.6;
  function startMvNova(id){
    const mv=multiverses.find(m=>m.id===id); if(!mv) return;
    markSeen(novaSeen,NOVA_KEY,id);
    if(reduceMotion){ shockwave(new THREE.Vector3(),new THREE.Color(1,1,1),clockNow(),20); novaToast(mv); return; }
    lockForCinematic();
    bang={kind:'mvnova',id,mv,colors:mv.members.map(m=>new THREE.Color(m.color)),t0:Infinity,boomed:false};
    const v=mvHomeView(); flyTo(v.pos.multiplyScalar(1.25),v.target,1.0,()=>{ if(bang) bang.t0=clockNow(); });
  }
  function updateMvNova(t,dt){
    const b=bang;
    if(view!=='mv' || mvCurrentId!==b.id){ endBang(); return; }
    if(t<b.t0) return;
    const e=t-b.t0, u=mvPlanetMat.uniforms, O=new THREE.Vector3();
    if(e<MVN_SWELL){
      const g=clamp01(e/MVN_SWELL);
      mvPlanet.scale.setScalar(MV_PLANET_R*(1+0.35*g*g));
      u.uGlow.value=1.4*g*g; mvPull=0.35*g;
      renderer.toneMappingExposure=EXPOSURE*(1+0.25*g);
      inflow(O,b.colors,isMobile?4:8,MV_PLANET_R*2,14,0.6);
      return;
    }
    if(!b.boomed){
      b.boomed=true;
      vibrate([60,40,120]); sound.boom();
      renderer.toneMappingExposure=EXPOSURE*2;
      shockwave(O,new THREE.Color(1,1,1),t,50,4);
      b.colors.forEach((c,i)=>shockwave(O,c,t+0.2+i*0.18,36+i*5,3.6));
      outburst(O,b.colors,isMobile?550:1200,5,24,0.975);
    }
    const k=clamp01((e-MVN_SWELL)/(MVN_END-MVN_SWELL));
    flash(1-(e-MVN_SWELL)/0.9);
    renderer.toneMappingExposure+=(EXPOSURE-renderer.toneMappingExposure)*Math.min(1,dt*1.2);
    // the planet settles back and crystallises
    mvPlanet.scale.setScalar(MV_PLANET_R*(1+0.35*(1-easeOutCubic(Math.min(1,k*2)))));
    u.uGlow.value=1.4*(1-easeOutCubic(Math.min(1,k*1.5)));
    u.uCrystal.value=easeOutCubic(k);
    mvPull=0.35*(1-easeOutCubic(Math.min(1,k*2)));
    if(k>=1){ const mv=multiverses.find(m=>m.id===b.id)||b.mv; endBang(); novaToast(mv); }
  }

  function endBang(){
    const b=bang; bang=null;
    if(!b) return;
    if(b.core){ scene.remove(b.core); b.core.material.dispose(); }
    (b.neb||[]).forEach(s=>{ scene.remove(s); s.material.dispose(); });
    if(b.p){ b.p.gather=0; b.p.scaleK=1; }
    if(b.kind==='mvnova'){ mvPlanet.scale.setScalar(MV_PLANET_R); mvPlanetMat.uniforms.uGlow.value=0; mvPull=0; }
    flash(0);
    renderer.toneMappingExposure=EXPOSURE; timeScale=1;
    gestureLock=false; controls.enabled=!camTween;
  }

  // ---------- the multiverse scene ----------
  const mvScene=new THREE.Scene();
  mvScene.add(new THREE.AmbientLight(0x5060a0,0.55));
  const mvSunLight=new THREE.DirectionalLight(0xfff1dd,1.7); mvSunLight.position.set(30,18,20); mvScene.add(mvSunLight);
  const mvLabelRenderer=new CSS2DRenderer();
  mvLabelRenderer.setSize(innerWidth,innerHeight);
  mvLabelRenderer.domElement.className='labels';
  mvLabelRenderer.domElement.style.display='none';
  stage.appendChild(mvLabelRenderer.domElement);
  const mvHitMeshes=[];
  const MV_PLANET_R=3.2;
  const MV_BANDS=30;   // the server's milestone limit
  // The shared planet develops with progress. Stage 0 is a dust cloud; the planet condenses, cools and
  // comes alive as milestones get done, and is a jewel once they all are.
  const MV_PLANET_VS=`
    varying vec3 vPos; varying vec3 vN; varying vec3 vW;
    void main(){
      vPos=position;
      vec4 wp=modelMatrix*vec4(position,1.0);
      vW=wp.xyz; vN=normalize(mat3(modelMatrix)*normal);
      gl_Position=projectionMatrix*viewMatrix*wp;
    }`;
  const MV_PLANET_FS=`
    uniform float uTime; uniform float uStage; uniform float uProgress; uniform float uOverdue; uniform float uFacets;
    uniform float uGlow; uniform float uCrystal;
    uniform vec3 uLight; uniform vec3 uBase; uniform int uCount; uniform vec4 uBands[${MV_BANDS}];
    varying vec3 vPos; varying vec3 vN; varying vec3 vW;
    ${NOISE_GLSL}
    void main(){
      vec3 p=normalize(vPos);
      vec3 N=normalize(vN);
      vec3 V=normalize(cameraPosition-vW);
      if(uFacets>0.5){ N=normalize(cross(dFdx(vW),dFdy(vW))); if(dot(N,V)<0.0) N=-N; }   // flat facets for the jewel
      float ndl=dot(N,uLight), lit=0.16+0.84*max(ndl,0.0);
      float s=uStage;
      float n1=fbm(p*2.3+vec3(3.1,1.7,0.4)), n2=fbm(p*6.0+vec3(0.0,uTime*0.015,0.0));
      // 1 molten rock: dark crust split by glowing cracks
      float crack=smoothstep(0.06,0.0,abs(n2-0.5));
      vec3 rock=mix(vec3(0.09,0.07,0.08),vec3(0.26,0.19,0.16),n1)*lit;
      vec3 lava=vec3(1.0,0.36,0.06)*crack*(1.6+0.6*sin(uTime*1.7+n1*12.0));
      vec3 col=mix(uBase*0.3*lit,rock+lava,clamp(s,0.0,1.0));
      // 2 oceans and land
      float land=smoothstep(0.5,0.53,n1);
      vec3 sea=mix(vec3(0.02,0.09,0.28),vec3(0.05,0.28,0.52),n2);
      vec3 ground=mix(vec3(0.16,0.3,0.12),vec3(0.46,0.39,0.25),n2);
      float spec=pow(max(dot(N,normalize(uLight+V)),0.0),40.0)*(1.0-land)*0.7;
      col=mix(col,mix(sea,ground,land)*lit+spec,clamp(s-1.0,0.0,1.0));
      // 3 clouds
      float cl=smoothstep(0.52,0.72,fbm(p*3.2+vec3(uTime*0.02,0.0,uTime*0.012)));
      col=mix(col,vec3(0.95)*lit,cl*0.75*clamp(s-2.0,0.0,1.0));
      // 4 city lights on the night side
      float night=1.0-smoothstep(-0.1,0.2,ndl);
      float cell=hash(floor(p*90.0));
      float city=land*(1.0-cl)*step(0.86,cell)*(0.6+0.4*sin(uTime*3.0+cell*40.0));
      col+=vec3(1.0,0.78,0.42)*city*night*clamp(s-3.0,0.0,1.0)*1.8;
      // 5 jewel: iridescent and sparkling
      float fres=pow(1.0-max(dot(N,V),0.0),2.0);
      vec3 iri=0.55+0.45*cos(6.2832*(fres*0.8+n1*0.6+vec3(0.0,0.33,0.67)+uTime*0.03));
      float spark=pow(max(dot(reflect(-uLight,N),V),0.0),60.0)*3.0;
      col=mix(col,iri*(0.5+0.7*lit)+spark,clamp(s-4.0,0.0,1.0)*0.85);
      // milestone bands: finished ones glow in the colour of whoever did them, the rest stay dim
      if(uCount>0){
        float f=acos(clamp(p.y,-1.0,1.0))/3.14159265*float(uCount);
        int i=int(min(floor(f),float(uCount-1)));
        vec4 b=uBands[i];
        col= b.a>0.5? mix(col,b.rgb*(0.45+0.75*lit),0.42)+b.rgb*0.12 : col*0.72;
        float edge=smoothstep(0.035,0.0,min(fract(f),1.0-fract(f)));
        if(f>0.5 && f<float(uCount)-0.5) col+=vec3(0.16)*edge;
      }
      // aurora at the poles once there's an atmosphere; red and flickering when the deadline has passed
      float pole=smoothstep(0.72,0.9,abs(p.y))*(1.0-smoothstep(0.94,1.0,abs(p.y)));
      float wave=0.5+0.5*sin(atan(p.z,p.x)*7.0+uTime*1.2+n2*6.0);
      float flick=mix(1.0,0.5+0.5*step(0.5,fract(sin(floor(uTime*9.0))*43758.5)),uOverdue);
      vec3 aur=mix(vec3(0.3,1.0,0.6),vec3(1.0,0.2,0.25),uOverdue);
      col+=aur*pole*wave*flick*max(clamp(s-2.0,0.0,1.0),uOverdue*0.6)*0.9;
      col*=mix(1.0,0.6,uOverdue)*(0.85+0.45*uProgress);
      col+=uBase*fres*0.35;
      // supernova flash, then the lasting glint of a completed goal
      col+=vec3(1.0,0.95,0.85)*uGlow+(spark*1.5+vec3(0.85,0.92,1.0)*fres*0.4)*uCrystal;
      gl_FragColor=vec4(col,0.3+0.7*clamp(s*1.2,0.0,1.0));
    }`;
  const STAGES=['Dust cloud','Molten rock','Oceans','Clouds and aurora','City lights','Jewel'];
  const stageOf=p=> p>=1? 5 : p<=0? 0 : 1+Math.min(3,Math.floor(p*4));
  function stageFor(mv){ const n=mv.milestones.length; if(mv.goal.status==='done') return 5; return stageOf(n? doneCount(mv)/n : (mv.goal.status==='done'?1:0)); }
  // how many more milestones until the next stage
  function nextStage(mv){
    const n=mv.milestones.length, d=doneCount(mv), s=stageFor(mv);
    for(let k=1;d+k<=n;k++){ const s2=stageOf((d+k)/n); if(s2>s) return {k,stage:s2}; }
    return null;
  }
  const mvPlanetMat=new THREE.ShaderMaterial({
    uniforms:{uTime:{value:0},uStage:{value:0},uProgress:{value:0},uOverdue:{value:0},uFacets:{value:0},uGlow:{value:0},uCrystal:{value:0},
      uLight:{value:new THREE.Vector3(30,18,20).normalize()},uBase:{value:new THREE.Color()},uCount:{value:0},
      uBands:{value:Array.from({length:MV_BANDS},()=>new THREE.Vector4())}},
    vertexShader:MV_PLANET_VS,fragmentShader:MV_PLANET_FS,transparent:true});
  const JEWEL_GEO=new THREE.IcosahedronGeometry(1,2);
  const mvPlanet=new THREE.Mesh(SPHERE,mvPlanetMat); mvPlanet.scale.setScalar(MV_PLANET_R); mvPlanet.rotation.z=0.3;
  // stage 0: a swirl of dust where the planet will form; it thins out as the planet condenses
  const mvDust=(()=>{
    const N=isMobile?700:1400, pos=new Float32Array(N*3);
    for(let i=0;i<N;i++){
      const r=MV_PLANET_R*(0.5+Math.pow(Math.random(),0.7)*2.3), a=Math.random()*Math.PI*2;
      pos[i*3]=Math.cos(a)*r; pos[i*3+1]=(Math.random()-0.5)*r*0.35; pos[i*3+2]=Math.sin(a)*r;
    }
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(pos,3));
    const d=new THREE.Points(g,new THREE.PointsMaterial({map:GLOW_TEX,size:0.5,color:0xffd9b0,transparent:true,opacity:0,
      blending:THREE.AdditiveBlending,depthWrite:false}));
    d.rotation.x=0.35; return d;
  })();
  mvScene.add(mvDust);
  let mvStage=0, mvStageShown=0;
  const mvAtmoMat=new THREE.ShaderMaterial({uniforms:{uColor:{value:new THREE.Color()},uIntensity:{value:1.2}},
    vertexShader:FRESNEL_VS,fragmentShader:ATMO_FS,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});
  const mvAtmo=new THREE.Mesh(SPHERE,mvAtmoMat); mvAtmo.scale.setScalar(MV_PLANET_R*1.2);
  const mvRing=new THREE.Mesh(DONE_RING_GEO,new THREE.MeshBasicMaterial({color:DONE_COLOR,transparent:true,opacity:0.6,
    side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));
  mvRing.rotation.x=-Math.PI/2+0.45; mvRing.scale.setScalar(MV_PLANET_R);
  const mvGlow=glowSprite(0xffffff,0.25,18);
  const mvPlanetHit=new THREE.Mesh(SPHERE,HIT_MAT); mvPlanetHit.scale.setScalar(MV_PLANET_R*1.2); mvPlanetHit.userData.mvPlanet=true;
  mvScene.add(mvGlow,mvPlanet,mvAtmo,mvRing,mvPlanetHit);
  mvHitMeshes.push(mvPlanetHit);
  const moons=new Map();   // userId -> moon
  const MOON_GEO=new THREE.SphereGeometry(1,32,24);
  const ORBIT_GEO=new THREE.BufferGeometry().setFromPoints(Array.from({length:129},(_,i)=>{ const a=i/128*Math.PI*2; return new THREE.Vector3(Math.cos(a),0,Math.sin(a)); }));
  let mvProgress=0, mvProgressShown=0, mvTexPending=false;
  const mvComets=[];

  // milestone bands and development stage; `initial` when just arriving (no stage-up celebration)
  function refreshMvSurface(mv,initial=false){
    const u=mvPlanetMat.uniforms, n=Math.min(mv.milestones.length,MV_BANDS);
    const colorOf=id=>{ const m=mv.members.find(x=>x.userId===id); return m? m.color : '#8a90b0'; };   // people who left fade to grey
    u.uCount.value=n;
    u.uBands.value.forEach((v,i)=>{
      const ms=mv.milestones[i];
      if(i<n && ms.doneAt){ const c=new THREE.Color(colorOf(ms.doneBy&&ms.doneBy.id)); v.set(c.r,c.g,c.b,1); }
      else v.set(0,0,0,0);
    });
    const s=stageFor(mv);
    if(!initial && s>mvStage) stageUp(s);
    mvStage=s;
  }
  function stageUp(s){
    const mv=currentMv(); if(!mv) return;
    const c=new THREE.Color(COLORS[mv.goal.importance]).lerp(new THREE.Color(1,1,1),0.4), t=clockNow();
    shockwave(new THREE.Vector3(),c,t+0.3,16,1.6); shockwave(new THREE.Vector3(),new THREE.Color(1,1,1),t+0.45,11,1.2);
    for(let i=0;i<(isMobile?120:240);i++){
      const d=randDir().clone();
      emit(d.clone().multiplyScalar(MV_PLANET_R),d.multiplyScalar(2+Math.random()*6),c,1+Math.random(),0.9+Math.random(),0.95);
    }
    vibrate(30);
    showToast(s===5? `💎 Every milestone is done. The planet is a jewel.` : `✨ The planet grew: ${STAGES[s].toLowerCase()} (stage ${s+1} of 6).`);
  }
  function makeMoon(m,i){
    const moon={userId:m.userId,group:new THREE.Group(),angle:Math.random()*Math.PI*2,r:15,targetR:15};
    moon.group.rotation.x=(i%2?1:-1)*(0.08+i*0.05); moon.group.rotation.z=i*0.07;
    moon.mat=new THREE.MeshStandardMaterial({roughness:0.5,metalness:0,transparent:true});
    moon.mesh=new THREE.Mesh(MOON_GEO,moon.mat);
    moon.orbitMat=new THREE.LineBasicMaterial({transparent:true,opacity:0.22,blending:THREE.AdditiveBlending,depthWrite:false});
    moon.orbit=new THREE.Line(ORBIT_GEO,moon.orbitMat);
    moon.hit=new THREE.Mesh(SPHERE,HIT_MAT); moon.hit.userData.moon=m.userId;
    moon.labelEl=el('div','moonlbl'); moon.label=new CSS2DObject(moon.labelEl); moon.label.center.set(0.5,0);
    moon.mesh.add(moon.label);
    // glows while that person is inside this multiverse right now
    moon.halo=glowSprite(0xffffff,0,3.2); moon.haloK=0; moon.wobble=-9;
    moon.group.add(moon.orbit,moon.halo,moon.mesh,moon.hit);
    mvScene.add(moon.group);
    mvHitMeshes.push(moon.hit);
    moons.set(m.userId,moon);
    return moon;
  }
  function destroyMoon(moon){
    const i=mvHitMeshes.indexOf(moon.hit); if(i>=0) mvHitMeshes.splice(i,1);
    moon.labelEl.remove(); mvScene.remove(moon.group);
    moon.mat.dispose(); moon.orbitMat.dispose(); moon.halo.material.dispose();
    moons.delete(moon.userId);
  }
  function moonWorld(moon,out=new THREE.Vector3()){ return moon.mesh.getWorldPosition(out); }
  // bring the scene in line with the multiverse's data; comets fly for newly completed milestones
  function syncMvScene(mv,prev){
    const col=new THREE.Color(COLORS[mv.goal.importance]);
    mvAtmoMat.uniforms.uColor.value.copy(col);
    mvGlow.material.color.copy(col);
    mvPlanetMat.uniforms.uBase.value.copy(col);
    mvPlanetMat.uniforms.uOverdue.value= mv.goal.status==='ongoing' && isoToDate(mv.goal.date)<today() ? 1 : 0;
    mvDust.material.color.copy(col).lerp(new THREE.Color(1,0.9,0.75),0.6);
    const n=mv.milestones.length, done=doneCount(mv);
    mvProgress= n? done/n : (mv.goal.status==='done'?1:0);
    mvRing.visible= mv.goal.status==='done' || (n>0 && done===n);
    $('mvTitle').textContent=mv.goal.name;

    const keep=new Set();
    mv.members.forEach((m,i)=>{
      keep.add(m.userId);
      const moon=moons.get(m.userId)||makeMoon(m,i);
      const mine=mv.milestones.filter(x=>x.doneAt && x.doneBy && x.doneBy.id===m.userId).length;
      moon.member=m; moon.done=mine;
      const active=m.status==='active';
      // more of the milestones done -> closer to the shared planet
      moon.targetR= active? 14-8*(n? mine/n : 0) : 17;
      const c=new THREE.Color(m.color);
      moon.mat.color.copy(c); moon.mat.emissive.copy(c).multiplyScalar(active?0.35:0.1); moon.mat.opacity=active?1:0.35;
      moon.orbitMat.color.copy(c); moon.orbitMat.opacity=active?0.22:0.08;
      moon.size=(m.isCreator?0.7:0.55);
      moon.halo.material.color.copy(c);
    });
    for(const moon of [...moons.values()]) if(!keep.has(moon.userId)) destroyMoon(moon);
    labelMoons();
    mvPlanetMat.uniforms.uCrystal.value= mv.completedAt && !(bang && bang.kind==='mvnova')? 1 : 0;
    syncTrail(mv,!prev);
    syncAttention();

    // comets for milestones completed since the last update
    const was=new Set(prev? prev.milestones.filter(m=>m.doneAt).map(m=>m.id) : mv.milestones.filter(m=>m.doneAt).map(m=>m.id));
    const fresh=mv.milestones.filter(m=>m.doneAt && !was.has(m.id));
    fresh.forEach((ms,i)=>{
      const moon=ms.doneBy && moons.get(ms.doneBy.id);
      if(moon) launchComet(moon,new THREE.Color(moon.member.color),i*0.35);
    });
    if(fresh.length && !reduceMotion) mvTexPending=true;   // repaint when the first comet lands
    else refreshMvSurface(mv,!prev);
    renderMvPanel(mv);
  }
  function launchComet(moon,color,delay){
    if(reduceMotion) return;
    const head=glowSprite(color.getHex(),1,2.2); head.visible=false;
    mvScene.add(head);
    mvComets.push({moon,color,head,t0:clockNow()+delay,dur:1.5,from:null});
  }
  function updateMvComets(t){
    for(let i=mvComets.length-1;i>=0;i--){
      const c=mvComets[i];
      if(t<c.t0) continue;
      if(!c.from){ c.from=moonWorld(c.moon); c.head.visible=true; }
      const k=clamp01((t-c.t0)/c.dur), e=easeInOutCubic(k);
      // arc from the moon up and over into the planet
      const to=c.from.clone().normalize().multiplyScalar(MV_PLANET_R*0.9);
      const mid=c.from.clone().lerp(to,0.5).add(new THREE.Vector3(0,4+c.from.length()*0.25,0));
      const a=c.from.clone().lerp(mid,e), b=mid.clone().lerp(to,e), p=a.lerp(b,e);
      c.head.position.copy(p);
      for(let j=0;j<3;j++) emit(p,randDir().multiplyScalar(0.4),c.color,1.3,0.5+Math.random()*0.5,0.96);
      if(k>=1){
        for(let j=0;j<(isMobile?60:120);j++) emit(p,randDir().multiplyScalar(1.5+Math.random()*4),c.color,1+Math.random(),0.8+Math.random(),0.95);
        shockwave(new THREE.Vector3(0,0,0),c.color,t);
        mvScene.remove(c.head); c.head.material.dispose();
        mvComets.splice(i,1);
        sound.note((Math.random()*10)|0,0.12);
        if(mvTexPending){ mvTexPending=false; const mv=currentMv(); if(mv) refreshMvSurface(mv); }
      }
    }
  }
  function updateMvScene(t,dt){
    mvPlanet.rotation.y+=dt*0.08;
    mvProgressShown+=(mvProgress-mvProgressShown)*Math.min(1,dt*1.5);
    const pr=mvProgressShown;
    // the planet develops toward its stage (from dust each time you arrive)
    const ds=mvStage-mvStageShown;
    mvStageShown+=Math.sign(ds)*Math.min(Math.abs(ds),dt*(reduceMotion?99:1.6));
    const u=mvPlanetMat.uniforms;
    u.uTime.value=t; u.uStage.value=mvStageShown; u.uProgress.value=pr;
    const jewel=mvStageShown>4.5;
    if(jewel!==(u.uFacets.value>0.5)){ u.uFacets.value=jewel?1:0; mvPlanet.geometry=jewel? JEWEL_GEO : SPHERE; }
    mvDust.rotation.y+=dt*0.25;
    mvDust.material.opacity=0.85*(1-clamp01(mvStageShown));
    mvDust.visible=mvDust.material.opacity>0.01;
    mvAtmo.visible=mvStageShown>0.5;
    mvAtmoMat.uniforms.uIntensity.value=(0.7+1.3*pr)*clamp01(mvStageShown-0.5);
    mvGlow.material.opacity=0.12+0.35*pr;
    mvGlow.scale.setScalar(16+8*pr+Math.sin(t*1.2)*0.6);
    mvRing.rotation.z+=dt*0.05;
    const inside=presence.get(mvCurrentId);
    for(const moon of moons.values()){
      moon.r+=(moon.targetR-moon.r)*Math.min(1,dt*1.2);
      moon.angle+=dt*0.9*Math.pow(8/moon.r,1.5)*0.35;
      const r=moon.r*(1-mvPull);
      moon.orbit.scale.setScalar(r);
      moon.mesh.position.set(Math.cos(moon.angle)*r,0,Math.sin(moon.angle)*r);
      // a nudge makes the moon wobble
      const w=t-moon.wobble, wob= w<1.6? Math.exp(-w*2.5)*Math.sin(w*26) : 0;
      if(wob) moon.mesh.position.y+=wob*0.5;
      const s=moon.size*(moon.hoverK||1)*(1+0.3*wob);
      moon.mesh.scale.setScalar(s);
      const here=!!(inside && inside.has(moon.userId) && moon.userId!==myId);
      moon.haloK+=((here?1:0)-moon.haloK)*Math.min(1,dt*3);
      moon.halo.position.copy(moon.mesh.position);
      moon.halo.material.opacity=moon.haloK*(0.55+0.25*Math.sin(t*3+moon.angle));
      moon.halo.scale.setScalar(Math.max(0.0001,s*(5+Math.sin(t*3)*0.6)));
      moon.hit.position.copy(moon.mesh.position); moon.hit.scale.setScalar(Math.max(1.3,s*2.2));
      moon.label.position.copy(camDown).multiplyScalar(1/s*(s+0.35));
    }
    updateMvComets(t);
    updateAttention(t,dt);
    updateMvPulses(t);
    updateTrail(t,dt);
  }
  let hoveredMoon=null;
  function setMoonHover(id){
    if(id===hoveredMoon) return;
    const prev=moons.get(hoveredMoon); if(prev){ prev.hoverK=1; prev.labelEl.classList.remove('hover'); }
    hoveredMoon=id;
    const m=moons.get(id); if(m){ m.hoverK=1.35; m.labelEl.classList.add('hover'); }
  }
  function tapMoon(userId){
    const moon=moons.get(userId), mv=currentMv(); if(!moon || !mv) return;
    const m=moon.member, who=m.userId===myId?'You':m.name;
    if(m.status!=='active'){ showToast(who+' has been invited and hasn\'t joined yet.'); return; }
    const n=mv.milestones.length;
    const stats=n? `${who} completed ${moon.done} of ${n} milestone${n===1?'':'s'}.` : `${who} ${m.userId===myId?'are':'is'} part of this multiverse.`;
    dustBurst(moonWorld(moon),new THREE.Color(m.color));
    if(m.userId===myId){ showToast(stats); return; }
    const here=othersInside(mv.id).includes(m.userId);
    showToast(stats+(here?" They're here now.":''),{label:'Nudge 👋',action:()=>sendNudge(m.userId),timeout:6000});
  }
  function tapMvPlanet(){
    const mv=currentMv(); if(!mv) return;
    dustBurst(new THREE.Vector3(0,MV_PLANET_R,0),new THREE.Color(COLORS[mv.goal.importance]));
    $('mvPanel').scrollTo({top:0,behavior:'smooth'});
  }
  function clearMvScene(){
    for(const moon of [...moons.values()]) destroyMoon(moon);
    for(const c of mvComets){ mvScene.remove(c.head); c.head.material.dispose(); }
    mvComets.length=0; mvTexPending=false; mvProgressShown=0; mvStage=0; mvStageShown=0;
    setMoonHover(null); setActHover(null);
    clearTrail(); clearAttention();
    for(const q of mvPulses){ mvScene.remove(q.head); q.head.material.dispose(); }
    mvPulses.length=0;
  }


  // =====================================================================
  // LIVE: presence, nudges, cheers, activity trail (Server-Sent Events from /api/live)
  // =====================================================================
  let liveSrc=null, serverOffset=0, liveRefreshTimer=null, socialRefreshTimer=null;
  // server timestamp (ms) -> this page's animation clock (s)
  function serverToClock(at){ return clockNow()+(at-(Date.now()+serverOffset))/1000; }
  async function sendLive(msg){
    try{
      const r=await fetch('/api/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(msg),keepalive:true});
      return await r.json();
    }catch(e){ return {error:"Couldn't reach the server. Check your connection."}; }
  }
  function connectLive(){
    if(disposed || typeof EventSource==='undefined') return;
    const es=liveSrc=new EventSource('/api/live');
    const on=(name,fn)=>es.addEventListener(name,e=>{ if(disposed) return; let d; try{ d=JSON.parse(e.data); }catch(err){ return; } fn(d); });
    on('hello',d=>{
      serverOffset=d.now-Date.now();
      presence.clear(); sysPresence.clear(); syncVisitors();
      presenceSent=null;   // (re)connected: announce where we are again
      refreshMultiverses();
    });
    // someone changed a multiverse: reload (a burst of changes becomes one reload)
    on('mv',()=>{ clearTimeout(liveRefreshTimer); liveRefreshTimer=setTimeout(()=>refreshMultiverses(true),120); });
    on('presence',onPresence);
    on('nudge',onNudge);
    on('cheer',onCheer);
    on('born',d=>schedule('bang',d.mvId,d.at));
    on('syspresence',onSysPresence);
    // your goals changed elsewhere (a note, a mentor's suggestion, another tab)
    on('goals',d=>{
      refreshGoals();
      if(d.note) showToast(`💬 ${d.note.from} left a note on "${d.note.goal}"`);
      if(d.suggestion) showToast(`🎓 ${d.suggestion.from} suggested a step for "${d.suggestion.goal}"`);
      if(d.note || d.suggestion) sound.ping();
    });
    // what your connections share changed
    on('social',()=>{ clearTimeout(socialRefreshTimer); socialRefreshTimer=setTimeout(()=>refreshSocial(true),150); });
    on('visit',d=>{
      showToast(`👀 ${d.from.name} is visiting your solar system`,{timeout:5000});
      sound.ping();
      clearTimeout(socialRefreshTimer); socialRefreshTimer=setTimeout(()=>refreshSocial(true),150);
    });
    on('nova',d=>schedule('nova',d.mvId,d.at));
    // EventSource reconnects by itself; the 30s refresh covers any gap
  }

  // ---------- presence ----------
  // While you're inside a multiverse, this tab tells the server, and where your camera is looking from.
  // Everyone else inside sees your moon glow and a small comet hovering on your side of the planet.
  let presenceSent=null, presenceT=0;
  const lastFocus=new THREE.Vector3(9,9,9);
  // Where you are: inside a multiverse, in someone's solar system (yours at home), or nowhere.
  function stepPresence(t){
    const room= readOnly || document.hidden || !liveSrc ? null
      : view==='mv' && mvCurrentId? 'mv:'+mvCurrentId
      : view==='galaxy' && !warp? 'sys:'+(visitSys? visitSys.key : myId) : null;
    if(!room){ leavePresence(); return; }
    const f=_t2.copy(camera.position).normalize();
    if(presenceSent!==room || (f.distanceTo(lastFocus)>0.12 && t-presenceT>0.6) || t-presenceT>20){
      presenceSent=room; presenceT=t; lastFocus.copy(f);
      const r2=x=>Math.round(Math.max(-1,Math.min(1,x))*100)/100, focus=[r2(f.x),r2(f.y),r2(f.z)];
      if(room.startsWith('mv:')) sendLive({type:'presence',mvId:room.slice(3),focus});
      else sendLive({type:'syspresence',hostId:room.slice(4),focus});
    }
  }
  function leavePresence(){
    if(!presenceSent) return;
    presenceSent=null;
    sendLive({type:'presence',mvId:null});
  }
  function onPresence(d){
    const prev=presence.get(d.mvId);
    const now=new Map(d.users.map(u=>[u.id,u.focus]));
    presence.set(d.mvId,now);
    const mv=multiverses.find(m=>m.id===d.mvId), p=portals.get(d.mvId);
    if(mv && p) portalLabel(p,mv);
    if(view==='mv' && mvCurrentId===d.mvId){
      // say hello when someone arrives
      for(const id of now.keys()) if(id!==myId && !(prev && prev.has(id))){
        const m=mv && mv.members.find(x=>x.userId===id);
        if(m && prev) showToast(`${m.name} just came in.`,{timeout:2500});
      }
      labelMoons(); syncAttention();
    }
  }
  function labelMoons(){
    const inside=presence.get(mvCurrentId);
    for(const moon of moons.values()){
      const m=moon.member, active=m.status==='active', here=!!(inside && inside.has(m.userId) && m.userId!==myId);
      moon.labelEl.className='moonlbl'+(active?'':' invited')+(here?' here':'')+(hoveredMoon===m.userId?' hover':'');
      moon.labelEl.textContent=(m.userId===myId?'You':m.name)+(m.isCreator?' ★':'')+(active?'':' · invited')+(here?' · here now':'');
    }
  }
  // attention comets: one per other person inside, on the side of the planet they're looking at
  const attention=new Map();   // userId -> {head, dir, target, color}
  function syncAttention(){
    const inside=presence.get(mvCurrentId), mv=currentMv();
    for(const [id,a] of [...attention]) if(!inside || !inside.has(id) || id===myId){ mvScene.remove(a.head); a.head.material.dispose(); attention.delete(id); }
    if(!inside || !mv) return;
    for(const [id,focus] of inside){
      if(id===myId) continue;
      const m=mv.members.find(x=>x.userId===id); if(!m) continue;
      let a=attention.get(id);
      if(!a){
        const color=new THREE.Color(m.color);
        a={head:glowSprite(color.getHex(),0.95,1.5),dir:new THREE.Vector3(0,1,0),target:new THREE.Vector3(0,1,0),color,phase:Math.random()*6};
        const moon=moons.get(id); if(moon) a.dir.copy(moonWorld(moon)).normalize();
        mvScene.add(a.head); attention.set(id,a);
      }
      if(focus) a.target.fromArray(focus).normalize();
    }
  }
  function updateAttention(t,dt){
    for(const a of attention.values()){
      a.dir.lerp(a.target,Math.min(1,dt*2)).normalize();
      // hover just above the surface on their side, circling a little
      const wob=_t1.set(Math.sin(t*1.7+a.phase),Math.cos(t*1.3+a.phase),Math.sin(t*1.1+a.phase*2)).multiplyScalar(0.12);
      a.head.position.copy(a.dir).add(wob).normalize().multiplyScalar(MV_PLANET_R*1.7);
      a.head.material.opacity=0.75+0.2*Math.sin(t*4+a.phase);
      if(!reduceMotion && Math.random()<dt*25) emit(a.head.position,randDir().multiplyScalar(0.3),a.color,1,0.5+Math.random()*0.4,0.96);
    }
  }
  function clearAttention(){ for(const a of attention.values()){ mvScene.remove(a.head); a.head.material.dispose(); } attention.clear(); }

  // ---------- nudges ----------
  const mvPulses=[];   // a glow travelling from one moon to another
  async function sendNudge(userId){
    const mv=currentMv(); if(!mv) return;
    const m=mv.members.find(x=>x.userId===userId); if(!m) return;
    const r=await sendLive({type:'nudge',mvId:mv.id,to:userId});
    if(r.error){ showToast(r.error); return; }
    nudgePulse(myId,userId);
    showToast(r.online? `You nudged ${m.name} 👋` : `You nudged ${m.name}, but they're not online right now, so they won't see it.`);
  }
  function nudgePulse(fromId,toId){
    const a=moons.get(fromId), b=moons.get(toId); if(!a || !b) return;
    if(reduceMotion){ b.wobble=clockNow(); return; }
    const color=new THREE.Color(a.member.color).lerp(new THREE.Color(1,1,1),0.35);
    const head=glowSprite(color.getHex(),1,2); mvScene.add(head);
    mvPulses.push({a,b,color,head,t0:clockNow(),dur:0.9});
  }
  function updateMvPulses(t){
    for(let i=mvPulses.length-1;i>=0;i--){
      const q=mvPulses[i], k=clamp01((t-q.t0)/q.dur), e=easeInOutCubic(k);
      const A=moonWorld(q.a,_t1), B=moonWorld(q.b,_t2);
      const mid=_t3.copy(A).add(B).multiplyScalar(0.5); mid.y+=3+A.distanceTo(B)*0.2;
      // quadratic arc A -> mid -> B
      const v=1-e;
      q.head.position.set(v*v*A.x+2*v*e*mid.x+e*e*B.x, v*v*A.y+2*v*e*mid.y+e*e*B.y, v*v*A.z+2*v*e*mid.z+e*e*B.z);
      emit(q.head.position,randDir().multiplyScalar(0.4),q.color,1.1,0.5,0.96);
      if(k>=1){
        q.b.wobble=t;
        shockwave(B.clone(),q.color,t,4,0.7);
        for(let j=0;j<40;j++) emit(B,randDir().multiplyScalar(1+Math.random()*3),q.color,0.9,0.6+Math.random()*0.5,0.95);
        mvScene.remove(q.head); q.head.material.dispose(); mvPulses.splice(i,1);
      }
    }
  }
  function onNudge(d){
    if(d.from.id===myId) return;   // already shown when sent
    const mv=multiverses.find(m=>m.id===d.mvId);
    const inHere=view==='mv' && mvCurrentId===d.mvId;
    if(inHere) nudgePulse(d.from.id,d.to);
    if(d.to!==myId) return;
    vibrate([30,60,30]); sound.ping();
    if(inHere) showToast(`${d.from.name} nudged you 👋`);
    else{
      const p=portals.get(d.mvId);
      if(p && view==='galaxy' && !visitSys && !reduceMotion) shockwave(p.group.position.clone(),new THREE.Color(1,0.9,0.7),clockNow(),10,1);
      showToast(`${d.from.name} nudged you in "${mv? mv.goal.name : 'a multiverse'}" 👋`,{label:'Enter',action:()=>enterMultiverse(d.mvId),timeout:8000});
    }
  }

  // ---------- cheers: double-tap a finished band ----------
  function bandAt(x,y){
    const r=canvas.getBoundingClientRect();
    ndc.set(((x-r.left)/r.width)*2-1,-((y-r.top)/r.height)*2+1);
    raycaster.setFromCamera(ndc,camera);
    const hit=raycaster.intersectObject(mvPlanetHit,false)[0];
    const mv=currentMv();
    if(!hit || !mv || !mv.milestones.length) return null;
    const local=mvPlanet.worldToLocal(hit.point.clone()).normalize();
    const n=Math.min(mv.milestones.length,MV_BANDS);
    const i=Math.min(n-1,Math.floor(Math.acos(Math.max(-1,Math.min(1,local.y)))/Math.PI*n));
    return {ms:mv.milestones[i],index:i,n};
  }
  async function cheerAt(x,y){
    const b=bandAt(x,y), mv=currentMv(); if(!b || !mv) return;
    if(!b.ms.doneAt){ showToast(`"${b.ms.title}" isn't done yet. Cheer it once it is.`); return; }
    const r=await sendLive({type:'cheer',mvId:mv.id,milestoneId:b.ms.id});
    if(r.error){ showToast(r.error); return; }
    cheerBurst(b.ms.id);
  }
  // sparks all around the milestone's band, in the colour of whoever finished it
  function cheerBurst(milestoneId){
    const mv=currentMv(); if(!mv) return;
    const n=Math.min(mv.milestones.length,MV_BANDS), i=mv.milestones.findIndex(m=>m.id===milestoneId);
    if(i<0 || i>=n) return;
    const ms=mv.milestones[i], m=ms.doneBy && mv.members.find(x=>x.userId===ms.doneBy.id);
    const color=new THREE.Color(m? m.color : '#ffffff'), white=new THREE.Color(1,1,1);
    const phi=(i+0.5)/n*Math.PI;
    for(let j=0;j<(isMobile?90:180);j++){
      const th=Math.random()*Math.PI*2, ph=phi+(Math.random()-0.5)*Math.PI/n*0.8;
      const P=mvPlanet.localToWorld(_t1.set(Math.sin(ph)*Math.cos(th),Math.cos(ph),Math.sin(ph)*Math.sin(th)).multiplyScalar(1.02));
      const out=_t2.copy(P).normalize().multiplyScalar(1.5+Math.random()*3.5).add(randDir().multiplyScalar(0.6));
      emit(P,out,Math.random()<0.25? white : color,0.9+Math.random()*0.8,0.8+Math.random()*0.7,0.95);
    }
    vibrate(15); sound.sparkle();
  }
  function onCheer(d){
    if(d.from.id===myId) return;
    if(view==='mv' && mvCurrentId===d.mvId) cheerBurst(d.milestoneId);
    if(d.doneBy===myId) showToast(`${d.from.name} cheered your "${d.title}" 🎉`);
  }

  // ---------- activity trail ----------
  // Recent events as a slow spiral of lights behind the planet, newest innermost. Tap one to fly to it.
  const trail={group:new THREE.Group(),marks:[],key:'',line:null};
  mvScene.add(trail.group);
  const ACT_ICON={CREATED:'✦',JOINED:'→',LEFT:'←',MILESTONE_ADDED:'+',MILESTONE_DONE:'✓',COMPLETED:'★'};
  function describeActivity(a){
    const who= a.actor? (a.actor.id===myId? 'You' : a.actor.name) : 'Someone who left';
    switch(a.kind){
      case 'CREATED': return `${who} created this multiverse`;
      case 'JOINED': return `${who} joined`;
      case 'LEFT': return a.text==='removed'? `${who} ${who==='You'?'were':'was'} removed` : `${who} left`;
      case 'MILESTONE_ADDED': return `${who} added "${a.text}"`;
      case 'MILESTONE_DONE': return `${who} completed "${a.text}"`;
      case 'COMPLETED': return 'The goal was completed together';
    }
    return who;
  }
  function relAgo(iso){
    const s=(Date.now()-new Date(iso).getTime())/1000;
    if(s<60) return 'just now';
    if(s<3600) return Math.floor(s/60)+' min ago';
    if(s<86400) return Math.floor(s/3600)+' h ago';
    if(s<86400*14){ const d=Math.floor(s/86400); return d+' day'+(d===1?'':'s')+' ago'; }
    return new Date(iso).toLocaleDateString();
  }
  function trailPos(j){
    const a=-0.6+j*0.55, r=21+j*0.9;
    return new THREE.Vector3(Math.cos(a)*r,-5+j*0.55,Math.sin(a)*r);
  }
  function clearTrail(){
    for(const mk of trail.marks){
      const i=mvHitMeshes.indexOf(mk.hit); if(i>=0) mvHitMeshes.splice(i,1);
      mk.labelEl.remove(); mk.glow.material.dispose();
    }
    trail.group.clear();
    if(trail.line){ trail.line.geometry.dispose(); trail.line.material.dispose(); trail.line=null; }
    trail.marks=[]; trail.key='';
  }
  function syncTrail(mv,initial){
    const key=mv.activity.map(a=>a.id).join(',');
    if(key===trail.key) return;
    const known=new Set(trail.marks.map(m=>m.id));
    clearTrail();
    trail.key=key;
    const colorOf=a=>{ const m=a.actor && mv.members.find(x=>x.userId===a.actor.id); return new THREE.Color(m? m.color : '#8a90b0'); };
    const pts=[];
    mv.activity.forEach((a,j)=>{
      const P=trailPos(j); pts.push(P);
      const color=a.kind==='COMPLETED'? new THREE.Color(1,0.95,0.8) : colorOf(a);
      const glow=glowSprite(color.getHex(),0.85,a.kind==='COMPLETED'||a.kind==='MILESTONE_DONE'?1.6:1.1); glow.position.copy(P);
      const hit=new THREE.Mesh(SPHERE,HIT_MAT); hit.position.copy(P); hit.scale.setScalar(1.3); hit.userData.act=a.id;
      const labelEl=el('div','actlbl'+(j<5?' recent':''),ACT_ICON[a.kind]+' '+describeActivity(a));
      const label=new CSS2DObject(labelEl); label.center.set(0.5,-0.4); label.position.copy(P);
      trail.group.add(glow,hit,label);
      mvHitMeshes.push(hit);
      // entries that just happened pop in
      trail.marks.push({id:a.id,a,glow,hit,labelEl,base:glow.scale.x,born: !initial && !known.has(a.id) ? clockNow() : -9});
    });
    if(pts.length>1){
      trail.line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(pts).getPoints(pts.length*8)),
        new THREE.LineBasicMaterial({color:0x6f64b8,transparent:true,opacity:0.18,blending:THREE.AdditiveBlending,depthWrite:false}));
      trail.group.add(trail.line);
    }
  }
  function updateTrail(t,dt){
    if(!reduceMotion) trail.group.rotation.y+=dt*0.015;
    for(const mk of trail.marks){
      const pop= t-mk.born<1.2? 1+2.5*Math.exp(-(t-mk.born)*3) : 1;
      mk.glow.scale.setScalar(mk.base*pop*(1+0.08*Math.sin(t*2+mk.base*9))*(hoveredAct===mk.id?1.5:1));
    }
  }
  let hoveredAct=null;
  function setActHover(id){
    if(id===hoveredAct) return;
    const prev=trail.marks.find(m=>m.id===hoveredAct); if(prev) prev.labelEl.classList.remove('hover');
    hoveredAct=id;
    const mk=trail.marks.find(m=>m.id===id); if(mk) mk.labelEl.classList.add('hover');
  }
  function tapActivity(id){
    const mk=trail.marks.find(m=>m.id===id); if(!mk) return;
    const P=mk.glow.getWorldPosition(new THREE.Vector3());
    const dir=P.clone().setY(0).normalize();
    flyTo(P.clone().addScaledVector(dir,9).add(new THREE.Vector3(0,3,0)),P,1.0);
    dustBurst(P,mk.glow.material.color);
    showToast(`${ACT_ICON[mk.a.kind]} ${describeActivity(mk.a)} · ${relAgo(mk.a.at)}`,{label:'Back',action:mvHome,timeout:6000});
  }

  // ---------- entering and leaving: fly into the portal, flash, come out inside ----------
  let warp=null, galaxyView=null;
  const SHARED_BG=()=>[farStars,nearDust,particles,...nebulae];
  function startWarp(mid){
    sound.rumble(0.8);
    if(reduceMotion){ mid(); return; }
    $('warp').classList.add('show');
    warp={phase:'in',t0:clockNow(),dur:0.45,from:camera.fov,to:100,mid};
  }
  function stepWarp(t){
    if(!warp) return;
    const k=clamp01((t-warp.t0)/warp.dur), e=warp.phase==='in'? k*k : easeOutCubic(k);
    camera.fov=THREE.MathUtils.lerp(warp.from,warp.to,e); camera.updateProjectionMatrix();
    if(k<1) return;
    if(warp.phase==='in'){
      const mid=warp.mid;
      warp={phase:'out',t0:t,dur:0.9,from:100,to:45};
      mid();
      $('warp').classList.remove('show');
    }else{ warp=null; camera.fov=45; camera.updateProjectionMatrix(); }
  }
  function mvHomeView(){ return {pos:new THREE.Vector3(0,11,innerWidth<=640?36:30),target:new THREE.Vector3(0,innerWidth<=640?-3:0,0)}; }
  function mvHome(){ const v=mvHomeView(); flyTo(v.pos,v.target,1.1); }
  function enterMultiverse(id){
    const mv=multiverses.find(m=>m.id===id); if(!mv) return;
    if(mv.myStatus!=='active'){ openMvList(); return; }
    if(visitSys){ exitVisit(()=>enterMultiverse(id)); return; }
    if(view==='mv' || warp || bang) return;
    closeDetail(false); closeSocial(); closeMvList();
    const p=portals.get(id);
    galaxyView={pos:camera.position.clone(),target:controls.target.clone()};
    const go=()=>startWarp(()=>showMv(mv));
    if(!p || reduceMotion){ go(); return; }
    const P=p.group.position.clone(), dir=camera.position.clone().sub(P).normalize();
    flyTo(P.clone().add(dir.multiplyScalar(9)),P,1.0,go);
  }
  function showMv(mv){
    view='mv'; mvCurrentId=mv.id;
    SHARED_BG().forEach(o=>mvScene.add(o));
    renderPass.scene=mvScene;
    labelRenderer.domElement.style.display='none'; mvLabelRenderer.domElement.style.display='';
    root.classList.add('in-mv');
    setHover(null);
    clearMvScene();
    syncMvScene(mv,null);
    mvProgressShown=0;   // the planet brightens up to its progress as you arrive
    controls.minDistance=6; controls.maxDistance=90;
    camera.position.set(0,40,110); controls.target.set(0,0,0); camera.lookAt(controls.target);
    const v=mvHomeView(); flyTo(v.pos,v.target,reduceMotion?0.01:1.8);
  }
  function exitMultiverse(){
    if(view!=='mv' || (warp && warp.phase==='in')) return;
    if(bang && bang.kind==='mvnova') endBang();
    closeMvForms();
    startWarp(()=>{
      view='galaxy'; const id=mvCurrentId; mvCurrentId=null;
      SHARED_BG().forEach(o=>scene.add(o));
      renderPass.scene=scene;
      mvLabelRenderer.domElement.style.display='none'; labelRenderer.domElement.style.display='';
      root.classList.remove('in-mv');
      clearMvScene();
      controls.minDistance=8; layoutSystems();
      const p=portals.get(id);
      if(p){ const P=p.group.position; camera.position.copy(P).add(new THREE.Vector3(0,4,10)); controls.target.copy(P); }
      const v=galaxyView||homeView(); galaxyView=null;
      flyTo(v.pos,v.target,reduceMotion?0.01:1.6);
    });
  }
  // ---------- visiting a connection's solar system ----------
  // Tap their sun-gate: the camera flies into it, the warp flashes, and you come out in their system with
  // only their sun, rings and planets around you. The home gate or "Galaxy" button brings you back.
  function visitFriend(key){
    const sys=systems.get(key), g=gates.get(key);
    if(!sys || view!=='galaxy' || visitSys || warp || bang || cast) return;
    closeDetail(false); closeSocial(); closeMvList();
    galaxyView={pos:camera.position.clone(),target:controls.target.clone()};
    const go=()=>startWarp(()=>showVisit(sys));
    if(!g || reduceMotion){ go(); return; }
    const P=g.group.position.clone(), dir=camera.position.clone().sub(P).normalize();
    flyTo(P.clone().add(dir.multiplyScalar(8)),P,1.0,go);
  }
  function showVisit(sys){
    visitSys=sys; savedView=null;
    api.recordVisit(sys.key).catch(()=>{});
    syncVisitors();
    homeLayer.visible=false; homeGate.group.visible=true;
    root.classList.add('in-visit');
    $('visitTitle').textContent=sys.name+"'s solar system";
    setHover(null); setGateHover(null);
    // their planets pop in as you arrive
    const now=clockNow(); let i=0;
    for(const p of planets.values()) if(p.sys===sys) p.scaleAnim={from:0,to:1,t0:now+0.3+(i++)*0.05,dur:reduceMotion?0.01:0.9,ease:easeOutBack};
    if(!sys.goals.length) showToast(`${sys.name} hasn't shared any goals yet.`);
    camera.position.set(0,120,240); controls.target.set(0,0,0); camera.lookAt(controls.target);
    const v=homeView(); flyTo(v.pos,v.target,reduceMotion?0.01:1.8);
  }
  function restoreHome(){
    visitSys=null;
    syncVisitors();
    homeLayer.visible=true; homeGate.group.visible=false;
    root.classList.remove('in-visit');
    setHover(null); setGateHover(null);
  }
  function exitVisit(then){
    if(!visitSys || warp) return;
    const key=visitSys.key;
    closeDetail(false);
    startWarp(()=>{
      restoreHome();
      const g=gates.get(key);
      if(g){ const P=g.group.position; camera.position.copy(P).add(new THREE.Vector3(0,4,10)); controls.target.copy(P); }
      const v=galaxyView||homeView(); galaxyView=null;
      flyTo(v.pos,v.target,reduceMotion?0.01:1.6,then);
    });
  }
  $('visitBack').addEventListener('click',()=>exitVisit());
  $('visitView').addEventListener('click',()=>flyHome());

  function closeMvForms(){ if(formOverlay.classList.contains('show') && formMode==='mv') formOverlay.classList.remove('show'); }
  $('mvBack').addEventListener('click',exitMultiverse);
  $('mvView').addEventListener('click',mvHome);

  // ---------- the side panel inside a multiverse ----------
  async function mvChange(change){
    const mv=currentMv(); if(!mv) return;
    try{
      const res=await api.submitMvChange(mv.id,change);
      if(res.error) showToast(res.error);
      else if(!res.applied) showToast(`Sent to ${mv.creator.name} for approval.`);
    }catch(e){ console.error(e); showToast("Couldn't send that change. Check your connection and retry."); }
    await refreshMultiverses(true);
  }
  function describeChange(c,mv){
    const t=c.milestoneTitle? `"${c.milestoneTitle}"` : 'a milestone';
    switch(c.kind){
      case 'GOAL_UPDATE': return c.payload && c.payload.name && c.payload.name!==mv.goal.name ? `edit the goal (rename to "${c.payload.name}")` : 'edit the goal details';
      case 'MILESTONE_ADD': return `add the milestone "${c.payload.title}"`;
      case 'MILESTONE_EDIT': return `rename ${t} to "${c.payload.title}"`;
      case 'MILESTONE_DELETE': return `delete ${t}`;
      case 'MILESTONE_DONE': return `mark ${t} as done`;
      case 'MILESTONE_UNDONE': return `mark ${t} as not done`;
    }
    return 'make a change';
  }
  function openMvGoalForm(mv){
    openForm({id:'',name:mv.goal.name,category:mv.goal.category,date:mv.goal.date,importance:mv.goal.importance,
      timeframe:'short',status:mv.goal.status,notes:mv.goal.notes,isPrivate:false});
    formMode='mv'; editingId=null;
    $('formTitle').textContent='Edit shared goal';
    $('tfField').style.display='none'; $('privacyField').style.display='none'; $('whyField').style.display='none';
    $('formApprovalHint').textContent= mv.isCreator? '' : `Your changes go to ${mv.creator.name} for approval before everyone sees them.`;
  }
  function renderMvPanel(mv){
    const panel=$('mvPanel'), scroll=panel.scrollTop;
    panel.textContent='';
    const n=mv.milestones.length, done=doneCount(mv);
    const colorOf=id=>{ const m=mv.members.find(x=>x.userId===id); return m? m.color : '#8a90b0'; };
    const nameOf=u=> u.id===myId? 'you' : u.name;

    // goal
    panel.append(el('h2',null,mv.goal.name));
    const meta=el('div','meta');
    const imp={high:'High',medium:'Medium',low:'Not necessary'}[mv.goal.importance], st={ongoing:'Ongoing',done:'Done',notdone:'Not done'}[mv.goal.status];
    meta.append(el('b',null,mv.goal.category),' · '+imp+' importance · '+st, el('br'),
      'Target '+isoToDate(mv.goal.date).toLocaleDateString()+' ('+relTime(mv.goal.date,mv.goal.status)+')', el('br'),
      'Created by '+(mv.creator.id===myId?'you':mv.creator.name));
    panel.append(meta);
    const bar=el('div','mvbar'), fillEl=el('i'); fillEl.style.width=(n? Math.round(done/n*100) : 0)+'%'; bar.append(fillEl);
    panel.append(bar, el('div','meta', n? `${done} of ${n} milestones done` : 'No milestones yet'));
    const stage=stageFor(mv), nx=nextStage(mv), stageEl=el('div','meta stage');
    stageEl.append('Planet: ',el('b',null,STAGES[stage]),` (stage ${stage+1} of 6)`);
    if(nx) stageEl.append(el('br'),`${nx.k} more milestone${nx.k===1?'':'s'} to ${STAGES[nx.stage].toLowerCase()}`);
    else if(stage<5 && !n) stageEl.append(el('br'),'Add milestones to help it grow');
    panel.append(stageEl);
    if(mv.goal.notes){ const nv=el('div','notes-view rich'); nv.innerHTML=sanitizeHtml(mv.goal.notes); panel.append(nv); }
    const edit=el('button','sbtn ghost editgoal','✎ Edit shared goal'); edit.addEventListener('click',()=>openMvGoalForm(mv));
    panel.append(edit);

    // approvals
    if(mv.isCreator && mv.pending.length){
      panel.append(el('h3',null,'Needs your approval ('+mv.pending.length+')'));
      const box=el('div');
      mv.pending.forEach(c=>box.append(personRow(c.author.name+' wants to '+describeChange(c,mv),new Date(c.createdAt).toLocaleString(),
        btn('Approve','',async()=>{ const r=await api.decideMvChange(c.id,true); if(r.error) showToast(r.error); await refreshMultiverses(true); }),
        btn('Reject','ghost',async()=>{ await api.decideMvChange(c.id,false); await refreshMultiverses(true); }))));
      panel.append(box);
    }
    if(!mv.isCreator && mv.pending.length){
      panel.append(el('h3',null,'Waiting for '+mv.creator.name));
      const box=el('div');
      mv.pending.forEach(c=>box.append(personRow('You asked to '+describeChange(c,mv),'waiting for approval',
        btn('Withdraw','ghost',async()=>{ await api.withdrawMvChange(c.id); await refreshMultiverses(true); }))));
      panel.append(box);
    }

    // milestones
    panel.append(el('h3',null,'Milestones'));
    const list=el('div');
    const waiting=new Set(mv.pending.filter(c=>c.milestoneId).map(c=>c.milestoneId));
    mv.milestones.forEach(ms=>{
      const row=el('div','ms'+(ms.doneAt?' done':''));
      const tick=el('button','tick'+(ms.doneAt?' on':''),ms.doneAt?'✓':'');
      tick.title=ms.doneAt?'Mark as not done':'Mark as done';
      if(ms.doneAt) tick.style.background=colorOf(ms.doneBy&&ms.doneBy.id);
      tick.addEventListener('click',async()=>{ tick.disabled=true; await mvChange({kind:ms.doneAt?'MILESTONE_UNDONE':'MILESTONE_DONE',milestoneId:ms.id,payload:{}}); });
      const who=el('div','who');
      who.append(el('div','nm',ms.title));
      if(waiting.has(ms.id)) who.append(el('div','sub wait','change waiting for approval'));
      else if(ms.doneAt) who.append(el('div','sub','done by '+(ms.doneBy? nameOf(ms.doneBy) : 'someone who left')));
      const ed=el('button','ib','✎'); ed.title='Rename';
      ed.addEventListener('click',()=>{
        who.textContent='';
        const inp=el('input'); inp.type='text'; inp.maxLength=200; inp.value=ms.title;
        const save=async()=>{ const v=inp.value.trim(); if(!v || v===ms.title){ renderMvPanel(mv); return; } await mvChange({kind:'MILESTONE_EDIT',milestoneId:ms.id,payload:{title:v}}); };
        inp.addEventListener('keydown',e=>{ if(e.key==='Enter') save(); else if(e.key==='Escape'){ e.stopPropagation(); renderMvPanel(mv); } });
        who.append(inp); ed.replaceWith(btn('Save','',save)); inp.focus(); inp.select();
      });
      const del=confirmBtn('🗑',async()=>{ await mvChange({kind:'MILESTONE_DELETE',milestoneId:ms.id,payload:{}}); });
      del.classList.add('ib'); del.title='Delete';
      row.append(tick,who,ed,del);
      list.append(row);
    });
    if(!n) list.append(el('p','sempty','Add the steps that lead to this goal.'));
    panel.append(list);
    const addRow=el('div','srow'); addRow.style.marginTop='8px';
    const addIn=el('input'); addIn.type='text'; addIn.maxLength=200; addIn.placeholder='Add a milestone…';
    const add=async()=>{ const v=addIn.value.trim(); if(!v) return; addIn.value=''; await mvChange({kind:'MILESTONE_ADD',payload:{title:v}}); };
    addIn.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); add(); } });
    addRow.append(addIn,btn('Add','',add));
    panel.append(addRow);

    // recent activity (the same entries float in the spiral behind the planet)
    if(mv.activity.length){
      panel.append(el('h3',null,'Recent activity'));
      const box=el('div','acts');
      mv.activity.slice(0,6).forEach(a=>{
        const row=el('button','act');
        row.append(el('span','ic',ACT_ICON[a.kind]),el('span','tx',describeActivity(a)),el('span','when',relAgo(a.at)));
        row.addEventListener('click',()=>tapActivity(a.id));
        box.append(row);
      });
      panel.append(box);
    }

    // members
    panel.append(el('h3',null,'People ('+mv.members.length+' of '+MV_MAX+')'));
    const people=el('div');
    mv.members.forEach(m=>{
      const mine=mv.milestones.filter(x=>x.doneAt && x.doneBy && x.doneBy.id===m.userId).length;
      const sub= m.status!=='active'? 'invited' : (m.isCreator?'creator · ':'')+mine+' done';
      const row=personRow((m.userId===myId?'You':m.name),sub, ...(mv.isCreator && !m.isCreator ? [confirmBtn('Remove',async()=>{
        const r=await api.removeMvMember(mv.id,m.userId); if(r.error) showToast(r.error); await refreshMultiverses(true); })] : []));
      const dot=el('span','mdot'); dot.style.background=m.color; row.prepend(dot);
      people.append(row);
    });
    panel.append(people);
    if(mv.isCreator && mv.members.length<MV_MAX){
      const can=social.friends.filter(f=>!mv.members.some(m=>m.userId===f.user.id));
      if(can.length){
        const row=el('div','srow'); row.style.marginTop='8px';
        const sel=el('select'); can.forEach(f=>{ const o=el('option',null,f.user.name); o.value=f.user.id; sel.append(o); });
        row.append(sel,btn('Invite','',async()=>{
          const r=await api.inviteMvMembers(mv.id,[sel.value]);
          if(r.error) showToast(r.error); else showToast('Invitation sent.');
          await refreshMultiverses(true);
        }));
        panel.append(row);
      }
    }

    // leave / delete
    const foot=el('div','foot');
    foot.append(mv.isCreator
      ? confirmBtn('Delete multiverse',async()=>{ const r=await api.deleteMultiverse(mv.id); if(r.error){ showToast(r.error); return; } showToast('Multiverse deleted.'); await refreshMultiverses(true); })
      : confirmBtn('Leave multiverse',async()=>{ const r=await api.leaveMultiverse(mv.id); if(r.error){ showToast(r.error); return; } showToast('You left the multiverse.'); await refreshMultiverses(true); }));
    panel.append(foot);
    panel.scrollTop=scroll;
  }

  addEventListener('keydown',e=>{
    if(e.key!=='Escape') return;
    if(cast) endCast(true);
    else if(root.classList.contains('shot')) exitShot();
    else if(moreOverlay.classList.contains('show')) closeMore();
    else if(socialOverlay.classList.contains('show')) closeSocial();
    else if(mcOverlay.classList.contains('show')) closeMvCreate();
    else if(mvOverlay.classList.contains('show')) closeMvList();
    else if(detailOverlay.classList.contains('show')) closeDetail();
    else if(formOverlay.classList.contains('show')) closeForm();
    else if(view==='mv') exitMultiverse();
    else if(visitSys) exitVisit();
  },{signal});

  // =====================================================================
  // ☰ MORE: sound, screenshot mode, sharing your galaxy, notifications, installing the app
  // =====================================================================
  const moreOverlay=$('moreOverlay');
  let installPrompt=null;
  addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); installPrompt=e; if(moreOverlay.classList.contains('show')) renderMore(); },{signal});
  function moreItem(icon,title,sub,...buttons){
    const row=el('div','sperson moreitem'), who=el('div','who');
    who.append(el('div','nm',icon+' '+title)); if(sub) who.append(el('div','sub',sub));
    row.append(who,...buttons); return row;
  }
  async function renderMore(){
    const box=$('moreList'); box.textContent='';
    box.append(moreItem(sound.on?'🔊':'🔇','Sound',sound.on?'Ambient space music and small sounds are on.':'Off. Turn on for ambient music and chimes.',
      btn(sound.on?'Turn off':'Turn on','',async()=>{ sound.set(!sound.on); renderMore(); })));
    box.append(moreItem('📷','Screenshot mode','Hide everything but the galaxy, then save a picture.',btn('Open','',async()=>enterShot())));
    if(readOnly) return;
    // a read-only link anyone can open
    const slug=social.publicSlug, url=slug? location.origin+'/g/'+slug : '';
    const share=moreItem('🌐','Share your galaxy',slug? 'Anyone with this link can look (read-only).' : 'Make a read-only link for a coach, mentor or family.',
      slug? confirmBtn('Turn off',async()=>{ const r=await api.setPublic(false); if(!r.error){ social.publicSlug=null; showToast('Your galaxy link is off. The old link no longer works.'); renderMore(); } })
          : btn('Create link','',async()=>{ const r=await api.setPublic(true); if(r.error){ showToast(r.error); return; } social.publicSlug=r.slug; renderMore(); }));
    box.append(share);
    if(slug){
      const row=el('div','srow linkrow'), inp=el('input'); inp.type='text'; inp.readOnly=true; inp.value=url;
      inp.addEventListener('focus',()=>inp.select());
      row.append(inp,btn('Copy','',async()=>{ try{ await navigator.clipboard.writeText(url); showToast('Link copied.'); }catch(e){ inp.select(); } }));
      box.append(row,el('p','shint','Visitors see goals shared with all your connections. "Only me" and "Chosen people" goals, notes and letters stay hidden.'));
    }
    // push notifications
    const ps=await pushState();
    box.append(moreItem('🔔','Notifications',
      ps==='unsupported'? 'This browser can\'t show notifications. On iPhone, install the app first (Share → Add to Home Screen).'
      : ps==='denied'? 'Blocked in your browser settings for this site.'
      : ps==='on'? 'On. You\'ll hear about nudges, notes, invites and big moments when Goal Galaxy is closed.'
      : 'Get told about nudges, notes, invites and big moments when Goal Galaxy is closed.',
      ...(ps==='on'? [btn('Turn off','ghost',async()=>{ await disablePush(); renderMore(); })]
        : ps==='off'? [btn('Turn on','',async()=>{ await enablePush(); renderMore(); })] : [])));
    // install
    const standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if(!standalone) box.append(moreItem('📲','Install the app',
      installPrompt? 'Put Goal Galaxy on your home screen or desktop, like any other app.' : 'In your browser menu choose "Install app" or "Add to Home Screen".',
      ...(installPrompt? [btn('Install','',async()=>{ installPrompt.prompt(); await installPrompt.userChoice.catch(()=>null); installPrompt=null; renderMore(); })] : [])));
  }
  function openMore(){ renderMore(); moreOverlay.classList.add('show'); }
  function closeMore(){ moreOverlay.classList.remove('show'); }
  $('moreBtn').addEventListener('click',openMore);
  $('moreX').addEventListener('click',closeMore);
  moreOverlay.addEventListener('click',e=>{ if(e.target===moreOverlay) closeMore(); });

  // ---------- push notifications ----------
  const swReady=()=>Promise.race([navigator.serviceWorker.ready,new Promise((_,no)=>setTimeout(()=>no(new Error('service worker not ready')),5000))]);
  async function pushState(){
    if(!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    if(Notification.permission==='denied') return 'denied';
    try{ const reg=await swReady(); return (await reg.pushManager.getSubscription())? 'on' : 'off'; }catch(e){ return 'unsupported'; }
  }
  function keyBytes(b64){
    const s=atob((b64+'='.repeat((4-b64.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'));
    return Uint8Array.from(s,c=>c.charCodeAt(0));
  }
  async function enablePush(){
    try{
      const key=await api.pushKey();
      if(!key){ showToast('Notifications aren\'t set up on this server yet.'); return; }
      if(await Notification.requestPermission()!=='granted'){ showToast('Notifications weren\'t allowed.'); return; }
      const reg=await swReady();
      const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(key)});
      const r=await api.savePush(sub.toJSON());
      if(r && r.error){ showToast(r.error); return; }
      showToast('🔔 Notifications are on.');
    }catch(e){ console.error(e); showToast('Couldn\'t turn on notifications in this browser.'); }
  }
  async function disablePush(){
    try{
      const reg=await swReady(), sub=await reg.pushManager.getSubscription();
      if(sub){ await api.removePush(sub.endpoint); await sub.unsubscribe(); }
      showToast('Notifications are off.');
    }catch(e){ console.error(e); }
  }

  // ---------- screenshot mode ----------
  // Hides the interface; "Save picture" renders one frame at extra resolution and downloads it.
  let shotLabels=false;
  function enterShot(){
    closeMore(); closeDetail(false); hideToast();
    root.classList.add('shot'); root.classList.toggle('shot-labels',shotLabels);
    $('shotLabels').textContent=shotLabels? 'Labels: on' : 'Labels: off';
  }
  function exitShot(){ root.classList.remove('shot','shot-labels'); }
  function takeShot(){
    const ratio=Math.min(3,(devicePixelRatio||1)*2);
    renderer.setPixelRatio(ratio); composer.setPixelRatio(ratio); composer.setSize(innerWidth,innerHeight);
    composer.render();
    // copy the frame (plus a small signature) before the browser clears the WebGL buffer
    const out=document.createElement('canvas'); out.width=canvas.width; out.height=canvas.height;
    const g=out.getContext('2d'); g.drawImage(canvas,0,0);
    const fs=Math.round(out.height*0.018);
    g.font=`${fs}px Georgia, serif`; g.fillStyle='rgba(232,236,255,.55)'; g.textAlign='right';
    g.fillText('Goal Galaxy · '+user.name,out.width-fs*1.2,out.height-fs*1.2);
    applyPixelRatio();
    out.toBlob(b=>{
      if(!b){ showToast('Couldn\'t save the picture.'); return; }
      const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='goal-galaxy-'+todayISO()+'.png';
      document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    },'image/png');
    $('bangFlash').style.transition='opacity .5s'; $('bangFlash').style.opacity='0.6';
    setTimeout(()=>{ $('bangFlash').style.opacity='0'; setTimeout(()=>{ $('bangFlash').style.transition=''; },500); },80);
    sound.sparkle();
  }
  $('shotTake').addEventListener('click',takeShot);
  $('shotExit').addEventListener('click',exitShot);
  $('shotLabels').addEventListener('click',()=>{ shotLabels=!shotLabels; root.classList.toggle('shot-labels',shotLabels); $('shotLabels').textContent=shotLabels? 'Labels: on' : 'Labels: off'; });

  // ---------- init ----------
  if(readOnly){
    root.classList.add('readonly');
    me.labelEl.textContent=user.name;
    $('roName').textContent=user.name+"'s Goal Galaxy";
  }
  nebulae.forEach((n,i)=>n.material.color.lerp(new THREE.Color(SEASON_COLORS[SEASON][i%3]),0.45));
  applyDaylight();
  const daylightTimer=setInterval(applyDaylight,60000);
  syncScene('initial');
  if(initialSocial) applySocial(initialSocial);
  applyMultiverses(multiverses);
  intro();
  if(!readOnly){
    connectLive();
    if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(e=>console.warn('service worker',e));
    // what happened on your goals while you were away
    const unread=goals.reduce((a,g)=>a+(g.guestNotes||[]).filter(n=>n.unread).length,0);
    const suggested=goals.reduce((a,g)=>a+(g.steps||[]).filter(x=>x.pending).length,0);
    if(unread || suggested) setTimeout(()=>{
      if(disposed) return;
      const first=goals.find(g=>(g.guestNotes||[]).some(n=>n.unread) || (g.steps||[]).some(x=>x.pending));
      const bits=[unread? `${unread} new note${unread===1?'':'s'}` : '',suggested? `${suggested} suggested step${suggested===1?'':'s'}` : ''].filter(Boolean);
      showToast(`💬 ${bits.join(' and ')} on your goals.`,{label:'Show',action:()=>first && focusGoal(first.id),timeout:8000});
    },reduceMotion?0:3400);
  }
  const firstInvite=multiverses.find(m=>m.myStatus!=='active');
  if(firstInvite) setTimeout(()=>{
    if(!disposed && !bang) showToast(`${firstInvite.creator.name} invited you to "${firstInvite.goal.name}". Hold its portal to join.`,
      {label:'Show me',action:()=>flyToPortal(firstInvite.id),timeout:9000});
  },reduceMotion?0:3200);

  return function dispose(){
    disposed=true;
    leavePresence();
    if(liveSrc) liveSrc.close();
    clearTimeout(liveRefreshTimer); clearTimeout(socialRefreshTimer);
    clearInterval(daylightTimer);
    sound.close();
    ac.abort();
    clearInterval(refreshTimer);
    clearTimeout(toastTimer); clearTimeout(deleteTimer);
    renderer.setAnimationLoop(null);
    controls.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    root.innerHTML='';
  };
}
