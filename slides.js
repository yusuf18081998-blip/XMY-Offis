(() => {
  'use strict';

  const STORAGE_KEY = 'xmy_slides_documents';
  const RECENT_KEY = 'xmy_recent';

  let state = {
    slides: [ freshSlide() ],
    active: 0
  };
  let docId = null;
  let selectedElId = null;
  let saveTimer = null;

  const slidePanel = document.getElementById('slidePanel');
  const canvas = document.getElementById('slideCanvas');
  const titleInput = document.getElementById('docTitle');
  const saveStatus = document.getElementById('saveStatus');
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');

  function freshSlide(){ return { id: uid(), bg:'#111111', elements: [] }; }
  function uid(){ return 'x_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  function activeSlide(){ return state.slides[state.active]; }

  /* ================= RENDER ================= */
  function render(){
    renderPanel();
    renderCanvas();
  }

  function renderPanel(){
    slidePanel.innerHTML = '';
    state.slides.forEach((slide, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'slide-thumb' + (i === state.active ? ' is-active' : '');
      thumb.style.background = slide.bg;
      const inner = document.createElement('div');
      inner.className = 'slide-thumb-inner';
      inner.style.width = '960px'; inner.style.height = '540px';
      inner.style.transform = 'scale(' + (168/960) + ')';
      slide.elements.forEach(el => inner.appendChild(renderElementNode(el, true)));
      thumb.appendChild(inner);
      const num = document.createElement('span'); num.className = 'thumb-num'; num.textContent = i+1;
      thumb.appendChild(num);
      thumb.addEventListener('click', () => { state.active = i; selectedElId = null; render(); });
      slidePanel.appendChild(thumb);
    });
  }

  function renderCanvas(){
    const slide = activeSlide();
    canvas.style.background = slide.bg;
    canvas.innerHTML = '';
    slide.elements.forEach(el => canvas.appendChild(renderElementNode(el, false)));
  }

  function renderElementNode(el, isThumb){
    const node = document.createElement('div');
    node.className = 'el' + (!isThumb && el.id === selectedElId ? ' is-selected' : '');
    node.dataset.type = el.type;
    node.dataset.id = el.id;
    node.style.left = el.x + 'px'; node.style.top = el.y + 'px';
    node.style.width = el.w + 'px'; node.style.height = el.h + 'px';

    if(el.type === 'text'){
      node.style.color = el.color || '#fff';
      node.style.fontSize = (el.fontSize||28) + 'px';
      node.textContent = el.text || '';
      if(!isThumb){
        node.contentEditable = 'true';
        node.spellcheck = false;
        node.addEventListener('input', () => { el.text = node.textContent; scheduleSave(); });
      }
    } else if(el.type === 'rect' || el.type === 'ellipse'){
      node.style.background = el.fill || '#39ff6a';
    } else if(el.type === 'image'){
      const img = document.createElement('img'); img.src = el.src; node.appendChild(img);
    }

    if(!isThumb){
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      node.appendChild(handle);
      bindDrag(node, el, handle);
      node.addEventListener('mousedown', e => { if(e.target !== handle) selectElement(el.id); });
    }
    return node;
  }

  function selectElement(id){
    selectedElId = id;
    renderCanvas();
    renderPanel();
  }

  /* ================= DRAG / RESIZE ================= */
  function bindDrag(node, el, handle){
    let mode = null, startX, startY, ox, oy, ow, oh;
    node.addEventListener('mousedown', e => {
      if(e.target === handle) return;
      if(node.isContentEditable && document.activeElement === node) return;
      mode = 'move'; startX = e.clientX; startY = e.clientY; ox = el.x; oy = el.y;
      e.stopPropagation();
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    handle.addEventListener('mousedown', e => {
      mode = 'resize'; startX = e.clientX; startY = e.clientY; ow = el.w; oh = el.h;
      e.stopPropagation(); e.preventDefault();
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    function onMove(e){
      const scale = canvas.getBoundingClientRect().width / 960;
      const dx = (e.clientX - startX) / scale, dy = (e.clientY - startY) / scale;
      if(mode === 'move'){
        el.x = Math.max(0, ox + dx); el.y = Math.max(0, oy + dy);
        node.style.left = el.x + 'px'; node.style.top = el.y + 'px';
      } else if(mode === 'resize'){
        el.w = Math.max(24, ow + dx); el.h = Math.max(24, oh + dy);
        node.style.width = el.w + 'px'; node.style.height = el.h + 'px';
      }
    }
    function onUp(){
      mode = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      renderPanel(); scheduleSave();
    }
  }

  canvas.addEventListener('mousedown', e => { if(e.target === canvas){ selectedElId = null; renderCanvas(); renderPanel(); } });

  /* ================= ADD ELEMENTS ================= */
  function addElement(el){
    activeSlide().elements.push(el);
    selectedElId = el.id;
    render();
    scheduleSave();
  }
  document.getElementById('addText').addEventListener('click', () => {
    addElement({ id: uid(), type:'text', x:120, y:220, w:400, h:80, text:'Matn kiriting', color:'#ffffff', fontSize:28 });
  });
  document.getElementById('addRect').addEventListener('click', () => {
    addElement({ id: uid(), type:'rect', x:150, y:150, w:260, h:160, fill:'#39ff6a' });
  });
  document.getElementById('addEllipse').addEventListener('click', () => {
    addElement({ id: uid(), type:'ellipse', x:180, y:180, w:180, h:180, fill:'#39ff6a' });
  });
  document.getElementById('addImage').addEventListener('click', () => document.getElementById('imageInput').click());
  document.getElementById('imageInput').addEventListener('change', e => {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => addElement({ id: uid(), type:'image', x:200, y:120, w:400, h:280, src: ev.target.result });
    reader.readAsDataURL(file);
  });

  document.getElementById('btnDeleteEl').addEventListener('click', () => {
    if(!selectedElId) return;
    const slide = activeSlide();
    slide.elements = slide.elements.filter(e => e.id !== selectedElId);
    selectedElId = null; render(); scheduleSave();
  });

  document.getElementById('slideBg').addEventListener('input', e => {
    activeSlide().bg = e.target.value; render(); scheduleSave();
  });
  document.getElementById('fillColor').addEventListener('input', e => {
    if(!selectedElId) return;
    const el = activeSlide().elements.find(x => x.id === selectedElId);
    if(!el) return;
    if(el.type === 'text') el.color = e.target.value; else el.fill = e.target.value;
    render(); scheduleSave();
  });

  /* ================= SLIDE MANAGEMENT ================= */
  document.getElementById('btnNewSlide').addEventListener('click', () => {
    state.slides.splice(state.active+1, 0, freshSlide());
    state.active++; selectedElId = null; render(); scheduleSave();
  });
  document.getElementById('btnDupSlide').addEventListener('click', () => {
    const copy = JSON.parse(JSON.stringify(activeSlide()));
    copy.id = uid(); copy.elements.forEach(e => e.id = uid());
    state.slides.splice(state.active+1, 0, copy);
    state.active++; render(); scheduleSave();
  });
  document.getElementById('btnDelSlide').addEventListener('click', () => {
    if(state.slides.length <= 1) return;
    state.slides.splice(state.active, 1);
    state.active = Math.max(0, state.active - 1);
    selectedElId = null; render(); scheduleSave();
  });

  /* ================= PRESENT MODE ================= */
  const overlay = document.getElementById('presentOverlay');
  const stage = document.getElementById('presentStage');
  const countEl = document.getElementById('presentCount');
  let presentIndex = 0;

  document.getElementById('btnPresent').addEventListener('click', () => {
    presentIndex = state.active;
    overlay.classList.add('is-open');
    renderPresentSlide();
  });
  document.getElementById('presentClose').addEventListener('click', () => overlay.classList.remove('is-open'));
  document.getElementById('presentPrev').addEventListener('click', () => { presentIndex = Math.max(0, presentIndex-1); renderPresentSlide(); });
  document.getElementById('presentNext').addEventListener('click', () => { presentIndex = Math.min(state.slides.length-1, presentIndex+1); renderPresentSlide(); });
  document.addEventListener('keydown', e => {
    if(!overlay.classList.contains('is-open')) return;
    if(e.key === 'Escape') overlay.classList.remove('is-open');
    if(e.key === 'ArrowRight' || e.key === ' ') { presentIndex = Math.min(state.slides.length-1, presentIndex+1); renderPresentSlide(); }
    if(e.key === 'ArrowLeft') { presentIndex = Math.max(0, presentIndex-1); renderPresentSlide(); }
  });
  function renderPresentSlide(){
    const slide = state.slides[presentIndex];
    stage.style.background = slide.bg;
    stage.innerHTML = '';
    const scaleWrap = document.createElement('div');
    scaleWrap.style.cssText = 'position:absolute;inset:0;';
    slide.elements.forEach(el => {
      const node = renderElementNode(el, true);
      node.style.transform = ''; // full scale in stage (stage is 16:9 same ratio 960x540 scaled by CSS aspect-ratio)
      node.style.position = 'absolute';
      node.style.left = (el.x/960*100) + '%';
      node.style.top = (el.y/540*100) + '%';
      node.style.width = (el.w/960*100) + '%';
      node.style.height = (el.h/540*100) + '%';
      if(el.type === 'text') node.style.fontSize = 'calc(' + (el.fontSize||28) + 'px * (100vw/1600))';
      scaleWrap.appendChild(node);
    });
    stage.appendChild(scaleWrap);
    countEl.textContent = (presentIndex+1) + ' / ' + state.slides.length;
  }

  /* ================= SAVE / LOAD ================= */
  function getAllDocs(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'); }catch(e){ return {}; } }
  function saveDoc(){
    const docs = getAllDocs();
    docId = docId || uid();
    docs[docId] = { id: docId, name: titleInput.value || 'Nomsiz taqdimot', slides: state.slides, updated: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
    updateRecent(docId, titleInput.value || 'Nomsiz taqdimot');
    saveStatus.textContent = 'Saqlandi';
  }
  function updateRecent(id, name){
    try{
      let recent = JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');
      recent = recent.filter(r => !(r.app==='slides' && r.id===id));
      recent.unshift({ app:'slides', id, name, type:'Taqdimot', updated: Date.now() });
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0,20)));
    }catch(e){}
  }
  function loadDocById(id){
    const docs = getAllDocs(); const d = docs[id]; if(!d) return;
    docId = id; titleInput.value = d.name; state.slides = d.slides; state.active = 0;
    render();
  }
  function scheduleSave(){
    saveStatus.textContent = 'Saqlanmoqda...';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDoc, 700);
  }
  titleInput.addEventListener('input', scheduleSave);

  /* ================= EXPORT (standalone HTML taqdimot) ================= */
  document.getElementById('btnExport').addEventListener('click', () => {
    const name = titleInput.value || 'taqdimot';
    const slidesHtml = state.slides.map(slide => {
      const els = slide.elements.map(el => {
        const posStyle = `position:absolute;left:${el.x/960*100}%;top:${el.y/540*100}%;width:${el.w/960*100}%;height:${el.h/540*100}%;`;
        if(el.type === 'text') return `<div style="${posStyle}color:${el.color||'#fff'};font-size:${el.fontSize||28}px;font-family:sans-serif;">${escapeHtml(el.text||'')}</div>`;
        if(el.type === 'rect') return `<div style="${posStyle}background:${el.fill||'#39ff6a'};border-radius:4px;"></div>`;
        if(el.type === 'ellipse') return `<div style="${posStyle}background:${el.fill||'#39ff6a'};border-radius:50%;"></div>`;
        if(el.type === 'image') return `<img src="${el.src}" style="${posStyle}object-fit:cover;">`;
        return '';
      }).join('');
      return `<section class="slide" style="background:${slide.bg}">${els}</section>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="uz"><head><meta charset="UTF-8"><title>${escapeHtml(name)}</title>
<style>
body{margin:0;background:#000;font-family:sans-serif}
.slide{position:relative;width:100vw;height:100vh;display:none}
.slide.active{display:block}
.nav{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10;color:#fff;font-family:monospace;display:flex;gap:1rem;align-items:center}
.nav button{background:#222;color:#fff;border:none;padding:.5rem 1rem;border-radius:20px;cursor:pointer}
</style></head><body>
${slidesHtml}
<div class="nav"><button onclick="go(-1)">&larr;</button><span id="cnt"></span><button onclick="go(1)">&rarr;</button></div>
<script>
let i=0; const slides=document.querySelectorAll('.slide');
function render(){slides.forEach((s,idx)=>s.classList.toggle('active', idx===i)); document.getElementById('cnt').textContent=(i+1)+' / '+slides.length;}
function go(d){ i=Math.max(0,Math.min(slides.length-1, i+d)); render(); }
document.addEventListener('keydown', e=>{ if(e.key==='ArrowRight') go(1); if(e.key==='ArrowLeft') go(-1); });
render();
<\/script></body></html>`;

    const blob = new Blob([html], { type:'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.html';
    a.click(); URL.revokeObjectURL(a.href);
    showToast(name + '.html yuklab olindi — brauzerda ochiladigan mustaqil taqdimot');
  });
  function escapeHtml(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function showToast(msg){
    toastText.textContent = msg;
    toast.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  /* ================= INIT ================= */
  const params = new URLSearchParams(location.search);
  if(params.get('open')) loadDocById(params.get('open'));
  else render();
  window.addEventListener('beforeunload', saveDoc);
})();
