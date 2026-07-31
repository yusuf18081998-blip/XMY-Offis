(() => {
  'use strict';
  const editor = document.getElementById('editor');
  const titleInput = document.getElementById('docTitle');
  const saveStatus = document.getElementById('saveStatus');
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');

  const STORAGE_KEY = 'xmy_docs_documents';
  const RECENT_KEY = 'xmy_recent';
  let docId = null;
  let saveTimer = null;

  /* ---------------- helpers ---------------- */
  function showToast(msg){
    toastText.textContent = msg;
    toast.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=>toast.classList.remove('is-visible'), 2200);
  }
  function uid(){ return 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  function getAllDocs(){
    try{ return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }catch(e){ return {}; }
  }
  function saveDoc(){
    const docs = getAllDocs();
    docId = docId || uid();
    docs[docId] = { id:docId, name:titleInput.value || 'Nomsiz hujjat', content: editor.innerHTML, updated: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
    updateRecent(docId, titleInput.value || 'Nomsiz hujjat');
    saveStatus.textContent = 'Saqlandi';
  }
  function updateRecent(id, name){
    try{
      let recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      recent = recent.filter(r => !(r.app === 'docs' && r.id === id));
      recent.unshift({ app:'docs', id, name, type:'Yozuv', updated: Date.now() });
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0,20)));
    }catch(e){}
  }
  function loadDocById(id){
    const docs = getAllDocs();
    const d = docs[id];
    if(!d) return;
    docId = id;
    titleInput.value = d.name;
    editor.innerHTML = d.content;
  }
  function scheduleSave(){
    saveStatus.textContent = 'Saqlanmoqda...';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDoc, 700);
  }

  /* ---------------- init: open from ?open= or fresh ---------------- */
  const params = new URLSearchParams(location.search);
  if(params.get('open')) loadDocById(params.get('open'));
  else editor.innerHTML = '<p></p>';

  /* ---------------- toolbar exec commands ---------------- */
  document.querySelectorAll('[data-cmd]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      editor.focus();
      document.execCommand(btn.dataset.cmd, false, null);
      scheduleSave();
      refreshToolbarState();
    });
  });

  document.getElementById('fmtBlock').addEventListener('change', e=>{
    editor.focus();
    document.execCommand('formatBlock', false, e.target.value);
    scheduleSave();
  });
  document.getElementById('fmtFont').addEventListener('change', e=>{
    editor.focus();
    document.execCommand('fontName', false, e.target.value);
    scheduleSave();
  });
  document.getElementById('fmtSize').addEventListener('change', e=>{
    editor.focus();
    document.execCommand('fontSize', false, e.target.value);
    scheduleSave();
  });
  document.getElementById('txtColor').addEventListener('input', e=>{
    editor.focus();
    document.execCommand('foreColor', false, e.target.value);
    scheduleSave();
  });
  document.getElementById('hlColor').addEventListener('input', e=>{
    editor.focus();
    document.execCommand('hiliteColor', false, e.target.value);
    scheduleSave();
  });
  document.getElementById('btnClearFmt').addEventListener('click', ()=>{
    editor.focus();
    document.execCommand('removeFormat', false, null);
    scheduleSave();
  });
  document.getElementById('btnUndo').addEventListener('click', ()=>{ editor.focus(); document.execCommand('undo'); });
  document.getElementById('btnRedo').addEventListener('click', ()=>{ editor.focus(); document.execCommand('redo'); });

  /* ---------------- link insert ---------------- */
  const linkModal = document.getElementById('linkModal');
  let savedSelection = null;
  document.getElementById('btnLink').addEventListener('click', ()=>{
    const sel = window.getSelection();
    if(sel.rangeCount) savedSelection = sel.getRangeAt(0);
    linkModal.classList.add('is-open');
    document.getElementById('linkUrl').focus();
  });
  document.getElementById('linkCancel').addEventListener('click', ()=> linkModal.classList.remove('is-open'));
  document.getElementById('linkOk').addEventListener('click', ()=>{
    const url = document.getElementById('linkUrl').value.trim();
    linkModal.classList.remove('is-open');
    if(!url) return;
    editor.focus();
    if(savedSelection){
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(savedSelection);
    }
    document.execCommand('createLink', false, url.startsWith('http') ? url : 'https://' + url);
    document.getElementById('linkUrl').value='';
    scheduleSave();
  });

  /* ---------------- image insert (local file only) ---------------- */
  document.getElementById('btnImage').addEventListener('click', ()=>{
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const file = inp.files[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        editor.focus();
        document.execCommand('insertImage', false, e.target.result);
        scheduleSave();
      };
      reader.readAsDataURL(file);
    };
    inp.click();
  });

  /* ---------------- word / char count ---------------- */
  function updateCounts(){
    const text = editor.innerText.trim();
    const words = text.length ? text.split(/\s+/).length : 0;
    document.getElementById('wordCount').textContent = words + " ta so'z";
    document.getElementById('charCount').textContent = text.length + ' ta belgi';
  }
  editor.addEventListener('input', ()=>{ updateCounts(); scheduleSave(); });
  updateCounts();

  /* ---------------- title rename ---------------- */
  titleInput.addEventListener('input', scheduleSave);

  /* ---------------- keyboard shortcuts ---------------- */
  editor.addEventListener('keydown', e=>{
    const mod = e.ctrlKey || e.metaKey;
    if(mod && e.key.toLowerCase() === 'b'){ e.preventDefault(); document.execCommand('bold'); }
    if(mod && e.key.toLowerCase() === 'i'){ e.preventDefault(); document.execCommand('italic'); }
    if(mod && e.key.toLowerCase() === 'u'){ e.preventDefault(); document.execCommand('underline'); }
    if(mod && e.key.toLowerCase() === 's'){ e.preventDefault(); saveDoc(); showToast('Hujjat saqlandi'); }
  });

  /* ---------------- toolbar active-state sync ---------------- */
  function refreshToolbarState(){
    ['bold','italic','underline','strikeThrough','justifyLeft','justifyCenter','justifyRight','justifyFull']
      .forEach(cmd=>{
        const btn = document.querySelector(`[data-cmd="${cmd}"]`);
        if(!btn) return;
        try{ btn.classList.toggle('is-active', document.queryCommandState(cmd)); }catch(e){}
      });
  }
  document.addEventListener('selectionchange', ()=>{
    if(document.activeElement === editor || editor.contains(document.activeElement)) refreshToolbarState();
  });

  /* ---------------- File menu (dropdown) ---------------- */
  const fileDropdown = document.getElementById('fileDropdown');
  document.getElementById('menuFile').addEventListener('click', e=>{
    e.stopPropagation();
    fileDropdown.classList.toggle('is-open');
  });
  document.addEventListener('click', ()=> fileDropdown.classList.remove('is-open'));

  fileDropdown.addEventListener('click', e=>{
    const action = e.target.closest('[data-action]')?.dataset.action;
    if(!action) return;
    if(action === 'new'){
      if(confirm("Yangi hujjat ochilsin? Saqlanmagan o'zgarishlar yo'qoladi.")){
        docId = null; titleInput.value = 'Nomsiz hujjat'; editor.innerHTML = '<p></p>';
        updateCounts();
      }
    }
    if(action === 'open') document.getElementById('fileInput').click();
    if(action === 'export-html') exportFile('html');
    if(action === 'export-txt') exportFile('txt');
    if(action === 'print') window.print();
  });

  document.getElementById('fileInput').addEventListener('change', e=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if(file.name.endsWith('.html')) editor.innerHTML = ev.target.result;
      else editor.innerHTML = '<p>' + ev.target.result.replace(/\n/g,'</p><p>') + '</p>';
      titleInput.value = file.name.replace(/\.(txt|html)$/,'');
      updateCounts(); saveDoc();
    };
    reader.readAsText(file);
  });

  function exportFile(type){
    const name = (titleInput.value || 'hujjat').trim();
    let blob, filename;
    if(type === 'html'){
      const html = `<!DOCTYPE html><html lang="uz"><head><meta charset="UTF-8"><title>${name}</title></head><body>${editor.innerHTML}</body></html>`;
      blob = new Blob([html], { type:'text/html' });
      filename = name + '.html';
    } else {
      blob = new Blob([editor.innerText], { type:'text/plain' });
      filename = name + '.txt';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(filename + ' yuklab olindi');
  }

  document.getElementById('btnExport').addEventListener('click', ()=> exportFile('html'));
  document.getElementById('btnPrint').addEventListener('click', ()=> window.print());

  /* autosave on unload */
  window.addEventListener('beforeunload', saveDoc);
})();
