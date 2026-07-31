(() => {
  'use strict';

  /* ================= STATE ================= */
  let ROWS = 30, COLS = 14; // A..N
  let cells = {};           // key "r_c" -> {raw, bold,italic,underline,bg,color,align,fmt}
  let docId = null, docName = 'Nomsiz jadval';
  let activeKey = '0_0';
  let saveTimer = null;

  const STORAGE_KEY = 'xmy_sheets_documents';
  const RECENT_KEY = 'xmy_recent';

  const gridScroll = document.getElementById('gridScroll');
  const formulaInput = document.getElementById('formulaInput');
  const cellRefEl = document.getElementById('cellRef');
  const titleInput = document.getElementById('docTitle');
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');
  const saveStatus = document.getElementById('saveStatus');

  /* ================= UTIL: column letters <-> index ================= */
  function colToLetter(n){
    let s = '';
    n++;
    while(n > 0){
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  function letterToCol(s){
    let n = 0;
    for(let i=0;i<s.length;i++) n = n*26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  function refToRC(ref){
    const m = ref.match(/^([A-Z]+)([0-9]+)$/);
    if(!m) return null;
    return { r: parseInt(m[2],10) - 1, c: letterToCol(m[1]) };
  }
  function rcToRef(r,c){ return colToLetter(c) + (r+1); }
  function key(r,c){ return r + '_' + c; }

  function getCell(r,c){ return cells[key(r,c)] || null; }
  function ensureCell(r,c){
    const k = key(r,c);
    if(!cells[k]) cells[k] = { raw:'', bold:false, italic:false, underline:false, bg:'', color:'', align:'left', fmt:'plain' };
    return cells[k];
  }

  /* ================= FORMULA ENGINE ================= */
  function tokenize(str){
    const tokens = []; let i = 0;
    while(i < str.length){
      const c = str[i];
      if(/\s/.test(c)){ i++; continue; }
      if(/[0-9.]/.test(c)){
        let j = i; while(j<str.length && /[0-9.]/.test(str[j])) j++;
        tokens.push({ t:'NUM', v: parseFloat(str.slice(i,j)) }); i = j; continue;
      }
      if(/[A-Za-z]/.test(c)){
        let j = i; while(j<str.length && /[A-Za-z]/.test(str[j])) j++;
        const letters = str.slice(i,j);
        let k2 = j; while(k2<str.length && /[0-9]/.test(str[k2])) k2++;
        if(k2 > j){ tokens.push({ t:'REF', v:(letters+str.slice(j,k2)).toUpperCase() }); i = k2; continue; }
        tokens.push({ t:'NAME', v: letters.toUpperCase() }); i = j; continue;
      }
      if(c === ':'){ tokens.push({t:'COLON'}); i++; continue; }
      if(c === ','){ tokens.push({t:'COMMA'}); i++; continue; }
      if(c === '('){ tokens.push({t:'LP'}); i++; continue; }
      if(c === ')'){ tokens.push({t:'RP'}); i++; continue; }
      if('+-*/^'.includes(c)){ tokens.push({t:'OP', v:c}); i++; continue; }
      i++;
    }
    return tokens;
  }

  const FUNCS = {
    SUM: args => flat(args).reduce((a,b)=>a+(typeof b==='number'?b:0), 0),
    AVERAGE: args => { const f = flat(args).filter(v=>typeof v==='number'); return f.length ? f.reduce((a,b)=>a+b,0)/f.length : 0; },
    MIN: args => { const f = flat(args).filter(v=>typeof v==='number'); return f.length ? Math.min(...f) : 0; },
    MAX: args => { const f = flat(args).filter(v=>typeof v==='number'); return f.length ? Math.max(...f) : 0; },
    COUNT: args => flat(args).filter(v=>typeof v==='number').length,
  };
  function flat(args){
    const out = [];
    args.forEach(a => Array.isArray(a) ? out.push(...a) : out.push(a));
    return out;
  }

  class Parser {
    constructor(tokens, ctx){ this.tokens = tokens; this.pos = 0; this.ctx = ctx; }
    peek(){ return this.tokens[this.pos]; }
    next(){ return this.tokens[this.pos++]; }
    parseExpression(){
      let v = this.parseTerm();
      while(this.peek() && this.peek().t === 'OP' && (this.peek().v==='+'||this.peek().v==='-')){
        const op = this.next().v; const rhs = this.parseTerm();
        v = op === '+' ? (v+rhs) : (v-rhs);
      }
      return v;
    }
    parseTerm(){
      let v = this.parseFactor();
      while(this.peek() && this.peek().t === 'OP' && (this.peek().v==='*'||this.peek().v==='/')){
        const op = this.next().v; const rhs = this.parseFactor();
        v = op === '*' ? (v*rhs) : (v/rhs);
      }
      return v;
    }
    parseFactor(){
      const t = this.peek();
      if(!t) return 0;
      if(t.t === 'OP' && t.v === '-'){ this.next(); return -this.parseFactor(); }
      if(t.t === 'NUM'){ this.next(); return t.v; }
      if(t.t === 'LP'){ this.next(); const v = this.parseExpression(); if(this.peek()&&this.peek().t==='RP') this.next(); return v; }
      if(t.t === 'NAME'){
        const name = this.next().v;
        if(this.peek() && this.peek().t === 'LP') this.next();
        const args = this.parseArgs();
        if(this.peek() && this.peek().t === 'RP') this.next();
        const fn = FUNCS[name];
        if(!fn) throw new Error('unknown fn');
        return fn(args);
      }
      if(t.t === 'REF'){
        this.next();
        if(this.peek() && this.peek().t === 'COLON'){
          this.next();
          const t2 = this.next();
          return this.rangeValues(t.v, t2.v);
        }
        return this.refValue(t.v);
      }
      this.next();
      return 0;
    }
    parseArgs(){
      const args = [];
      if(this.peek() && this.peek().t === 'RP') return args;
      while(true){
        if(this.peek() && this.peek().t === 'REF'){
          const startPos = this.pos;
          const r1 = this.next().v;
          if(this.peek() && this.peek().t === 'COLON'){
            this.next(); const r2 = this.next().v;
            args.push(this.rangeValues(r1, r2));
          } else {
            this.pos = startPos;
            args.push(this.parseExpression());
          }
        } else {
          args.push(this.parseExpression());
        }
        if(this.peek() && this.peek().t === 'COMMA'){ this.next(); continue; }
        break;
      }
      return args;
    }
    refValue(ref){
      const rc = refToRC(ref);
      if(!rc) return 0;
      const v = evaluateCell(key(rc.r, rc.c), this.ctx);
      return typeof v === 'number' ? v : (v ? 0 : 0);
    }
    rangeValues(r1, r2){
      const a = refToRC(r1), b = refToRC(r2);
      if(!a || !b) return [];
      const rMin = Math.min(a.r,b.r), rMax = Math.max(a.r,b.r);
      const cMin = Math.min(a.c,b.c), cMax = Math.max(a.c,b.c);
      const out = [];
      for(let r=rMin;r<=rMax;r++) for(let c=cMin;c<=cMax;c++){
        const v = evaluateCell(key(r,c), this.ctx);
        out.push(typeof v === 'number' ? v : 0);
      }
      return out;
    }
  }

  function evaluateCell(k, ctx){
    if(ctx.memo.has(k)) return ctx.memo.get(k);
    if(ctx.visiting.has(k)) return '#SIKL';
    const cell = cells[k];
    if(!cell || cell.raw === ''){ ctx.memo.set(k, 0); return 0; }
    const raw = cell.raw;
    if(raw.startsWith('=')){
      ctx.visiting.add(k);
      try{
        const tokens = tokenize(raw.slice(1));
        const parser = new Parser(tokens, ctx);
        let val = parser.parseExpression();
        if(typeof val !== 'number' || isNaN(val)) val = Array.isArray(val) ? (val[0] ?? 0) : '#XATO';
        ctx.visiting.delete(k); ctx.memo.set(k, val);
        return val;
      }catch(e){ ctx.visiting.delete(k); ctx.memo.set(k, '#XATO'); return '#XATO'; }
    }
    const num = parseFloat(raw);
    const val = (raw.trim() !== '' && !isNaN(num) && /^-?[0-9.]+$/.test(raw.trim())) ? num : raw;
    ctx.memo.set(k, val);
    return val;
  }

  function recalcAll(){
    const ctx = { memo: new Map(), visiting: new Set() };
    Object.keys(cells).forEach(k => evaluateCell(k, ctx));
    return ctx.memo;
  }

  function formatDisplay(val, fmt){
    if(typeof val !== 'number') return val;
    if(fmt === 'currency') return val.toLocaleString('uz-UZ', {maximumFractionDigits:2}) + " so'm";
    if(fmt === 'percent') return (val*100).toLocaleString('uz-UZ',{maximumFractionDigits:2}) + '%';
    return Number.isInteger(val) ? String(val) : String(Math.round(val*10000)/10000);
  }

  /* ================= RENDER ================= */
  function buildGrid(){
    let html = '<table class="sheet"><thead><tr><th class="corner"></th>';
    for(let c=0;c<COLS;c++) html += `<th class="col-header">${colToLetter(c)}</th>`;
    html += '</tr></thead><tbody>';
    for(let r=0;r<ROWS;r++){
      html += `<tr><th class="row-header">${r+1}</th>`;
      for(let c=0;c<COLS;c++){
        html += `<td class="cell" data-r="${r}" data-c="${c}" contenteditable="true" spellcheck="false"></td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    gridScroll.innerHTML = html;
    refreshAllCells();
    bindGridEvents();
  }

  function refreshAllCells(){
    const memo = recalcAll();
    gridScroll.querySelectorAll('td.cell').forEach(td => paintCell(td, memo));
  }

  function paintCell(td, memo){
    const r = +td.dataset.r, c = +td.dataset.c;
    const k = key(r,c);
    const cell = cells[k];
    const isFocused = document.activeElement === td;
    if(!cell){
      if(!isFocused) td.textContent = '';
      td.classList.remove('err');
      td.style.fontWeight=''; td.style.fontStyle=''; td.style.textDecoration='';
      td.style.background=''; td.style.color=''; td.style.textAlign='';
      return;
    }
    if(!isFocused){
      const val = memo ? memo.get(k) : cell.raw;
      const display = formatDisplay(val, cell.fmt);
      td.textContent = display === undefined ? '' : display;
      td.classList.toggle('err', typeof display === 'string' && display.startsWith('#'));
    }
    td.style.fontWeight = cell.bold ? '700' : '400';
    td.style.fontStyle = cell.italic ? 'italic' : 'normal';
    td.style.textDecoration = cell.underline ? 'underline' : 'none';
    td.style.background = cell.bg || '';
    td.style.color = cell.color || '';
    td.style.textAlign = cell.align || 'left';
  }

  /* ================= SELECTION / EDITING ================= */
  function setActive(r, c, focusCell = true){
    activeKey = key(r,c);
    cellRefEl.textContent = rcToRef(r,c);
    const cell = getCell(r,c);
    formulaInput.value = cell ? cell.raw : '';
    gridScroll.querySelectorAll('td.is-selected').forEach(td => td.classList.remove('is-selected'));
    const td = gridScroll.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
    if(td){
      td.classList.add('is-selected');
      if(focusCell){ td.textContent = cell ? cell.raw : ''; placeCaretEnd(td); td.focus(); }
    }
    syncToolbarButtons();
  }
  function placeCaretEnd(el){
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }

  function commitCell(td){
    const r = +td.dataset.r, c = +td.dataset.c;
    const raw = td.textContent;
    if(raw === '' ){ delete cells[key(r,c)]; }
    else { ensureCell(r,c).raw = raw; }
    refreshAllCells();
    scheduleSave();
  }

  function bindGridEvents(){
    gridScroll.addEventListener('focusin', e => {
      const td = e.target.closest('td.cell'); if(!td) return;
      const r = +td.dataset.r, c = +td.dataset.c;
      activeKey = key(r,c);
      cellRefEl.textContent = rcToRef(r,c);
      const cell = getCell(r,c);
      formulaInput.value = cell ? cell.raw : '';
      gridScroll.querySelectorAll('td.is-selected').forEach(t => t.classList.remove('is-selected'));
      td.classList.add('is-selected');
      td.textContent = cell ? cell.raw : '';
      syncToolbarButtons();
    });
    gridScroll.addEventListener('focusout', e => {
      const td = e.target.closest('td.cell'); if(!td) return;
      commitCell(td);
    });
    gridScroll.addEventListener('keydown', e => {
      const td = e.target.closest('td.cell'); if(!td) return;
      const r = +td.dataset.r, c = +td.dataset.c;
      if(e.key === 'Enter'){ e.preventDefault(); commitCell(td); moveActive(r+1, c); }
      else if(e.key === 'Tab'){ e.preventDefault(); commitCell(td); moveActive(r, e.shiftKey ? c-1 : c+1); }
      else if(e.key === 'Escape'){ e.preventDefault(); td.textContent = getCell(r,c)?.raw || ''; td.blur(); }
      else if(e.key === 'ArrowDown' && (window.getSelection().isCollapsed)){ /* allow default typing but arrow nav when not editing text lines */ }
    });
  }
  function moveActive(r, c){
    r = Math.max(0, Math.min(ROWS-1, r));
    c = Math.max(0, Math.min(COLS-1, c));
    setActive(r, c, true);
  }

  /* ================= FORMULA BAR ================= */
  formulaInput.addEventListener('keydown', e => {
    if(e.key === 'Enter'){
      const [r,c] = activeKey.split('_').map(Number);
      const raw = formulaInput.value;
      if(raw === ''){ delete cells[key(r,c)]; } else { ensureCell(r,c).raw = raw; }
      refreshAllCells();
      scheduleSave();
      moveActive(r+1, c);
    }
  });

  /* ================= TOOLBAR ================= */
  function activeRC(){ return activeKey.split('_').map(Number); }
  function syncToolbarButtons(){
    const [r,c] = activeRC();
    const cell = getCell(r,c) || {};
    document.querySelectorAll('[data-style]').forEach(b => b.classList.toggle('is-active', !!cell[b.dataset.style]));
    document.querySelectorAll('[data-align]').forEach(b => b.classList.toggle('is-active', (cell.align||'left') === b.dataset.align));
    document.getElementById('numFormat').value = cell.fmt || 'plain';
  }
  document.querySelectorAll('[data-style]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const [r,c] = activeRC();
      const cell = ensureCell(r,c);
      cell[btn.dataset.style] = !cell[btn.dataset.style];
      refreshAllCells(); syncToolbarButtons(); scheduleSave();
    });
  });
  document.querySelectorAll('[data-align]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const [r,c] = activeRC();
      ensureCell(r,c).align = btn.dataset.align;
      refreshAllCells(); syncToolbarButtons(); scheduleSave();
    });
  });
  document.getElementById('cellBg').addEventListener('input', e=>{
    const [r,c] = activeRC(); ensureCell(r,c).bg = e.target.value; refreshAllCells(); scheduleSave();
  });
  document.getElementById('cellColor').addEventListener('input', e=>{
    const [r,c] = activeRC(); ensureCell(r,c).color = e.target.value; refreshAllCells(); scheduleSave();
  });
  document.getElementById('numFormat').addEventListener('change', e=>{
    const [r,c] = activeRC(); ensureCell(r,c).fmt = e.target.value; refreshAllCells(); scheduleSave();
  });

  /* ================= ROW / COL ADD-DELETE ================= */
  document.getElementById('btnAddRow').addEventListener('click', ()=>{ ROWS++; buildGrid(); scheduleSave(); });
  document.getElementById('btnAddCol').addEventListener('click', ()=>{ COLS++; buildGrid(); scheduleSave(); });
  document.getElementById('btnDelRow').addEventListener('click', ()=>{
    if(ROWS<=1) return;
    const [r] = activeRC();
    Object.keys(cells).forEach(k=>{
      const [rr,cc] = k.split('_').map(Number);
      if(rr === r) delete cells[k];
      else if(rr > r) { cells[key(rr-1,cc)] = cells[k]; delete cells[k]; }
    });
    ROWS--; buildGrid(); scheduleSave();
  });
  document.getElementById('btnDelCol').addEventListener('click', ()=>{
    if(COLS<=1) return;
    const [,c] = activeRC();
    Object.keys(cells).forEach(k=>{
      const [rr,cc] = k.split('_').map(Number);
      if(cc === c) delete cells[k];
      else if(cc > c){ cells[key(rr,cc-1)] = cells[k]; delete cells[k]; }
    });
    COLS--; buildGrid(); scheduleSave();
  });

  /* ================= SAVE / LOAD ================= */
  function uid(){ return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function getAllDocs(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'); }catch(e){ return {}; } }
  function saveDoc(){
    const docs = getAllDocs();
    docId = docId || uid();
    docs[docId] = { id:docId, name: titleInput.value || 'Nomsiz jadval', rows:ROWS, cols:COLS, cells, updated: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
    updateRecent(docId, titleInput.value || 'Nomsiz jadval');
    saveStatus.textContent = 'Saqlandi';
  }
  function updateRecent(id, name){
    try{
      let recent = JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');
      recent = recent.filter(r=>!(r.app==='sheets' && r.id===id));
      recent.unshift({app:'sheets', id, name, type:'Jadval', updated: Date.now()});
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0,20)));
    }catch(e){}
  }
  function loadDocById(id){
    const docs = getAllDocs(); const d = docs[id]; if(!d) return;
    docId = id; titleInput.value = d.name; ROWS = d.rows; COLS = d.cols; cells = d.cells || {};
    buildGrid();
  }
  function scheduleSave(){
    saveStatus.textContent = 'Saqlanmoqda...';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDoc, 700);
  }
  titleInput.addEventListener('input', scheduleSave);

  /* ================= EXPORT / IMPORT CSV ================= */
  document.getElementById('btnExport').addEventListener('click', ()=>{
    const memo = recalcAll();
    const rows = [];
    for(let r=0;r<ROWS;r++){
      const row = [];
      for(let c=0;c<COLS;c++){
        const v = memo.get(key(r,c));
        row.push(v === undefined || v === 0 && !getCell(r,c) ? '' : String(v).replace(/"/g,'""'));
      }
      rows.push(row.map(v => /[",\n]/.test(v) ? `"${v}"` : v).join(','));
    }
    const blob = new Blob([rows.join('\n')], { type:'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (titleInput.value || 'jadval') + '.csv';
    a.click(); URL.revokeObjectURL(a.href);
    showToast('CSV yuklab olindi');
  });

  document.getElementById('menuFile').addEventListener('click', ()=>{
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', e=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      const lines = text.split(/\r?\n/).filter(l=>l.length);
      cells = {}; ROWS = Math.max(lines.length, 10);
      let maxCols = 1;
      lines.forEach((line, r) => {
        const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^$)/g) || line.split(',');
        vals.forEach((v, c) => {
          maxCols = Math.max(maxCols, c+1);
          const clean = v.replace(/^"|"$/g,'').replace(/""/g,'"');
          if(clean !== '') ensureCell(r,c).raw = clean;
        });
      });
      COLS = Math.max(maxCols, 8);
      titleInput.value = file.name.replace(/\.csv$/,'');
      buildGrid(); saveDoc();
    };
    reader.readAsText(file);
  });

  function showToast(msg){
    toastText.textContent = msg;
    toast.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=>toast.classList.remove('is-visible'), 2200);
  }

  /* ================= INIT ================= */
  const params = new URLSearchParams(location.search);
  if(params.get('open')) loadDocById(params.get('open'));
  else buildGrid();
  setActive(0,0,false);
  window.addEventListener('beforeunload', saveDoc);
})();
