// ======== Data fallbacks (edit these) =========

let VIDEOS = [];                 // current archive list (what you filter/sort)
let ALL_BY_ID = new Map();       // cross-archive lookup by id
let OTHER_VIDEOS = [];
let SPONSORS = [];


const SPONSORS_FALLBACK = [
  // { brand:"Manta Sleep", logo:"/img/manta.png", link:"/manta", expires:"2025-12-31", disclosure:"Paid promotion" },
];

// Support & Contact links
const SUPPORT_LINKS = {
  patreon: "https://patreon.com/SeeThePattern",
  kofi: "https://ko-fi.com/seethepattern",
  paypal: "https://paypal.me/seethepattern",
  merch: "https://see-the-pattern.myspreadshop.co.uk/"
};
const CONTACT = {
  email: "contact@seethepattern.org"
};
// ===================================


const controls = document.getElementById('controls');


async function loadJSON(url){
  const res = await fetch(url, { cache: 'no-store' });
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}


// --- CSV helper ---
async function loadText(url){
  const res = await fetch(url, { cache: 'no-store' });
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function isReflectionId(id){
  const p = window.ARCHIVE?.reflectionPrefix || 'REF-';
  return typeof id === 'string' && id.startsWith(p);
}

function pageForId(id){
  // REF-* always goes to reflections; otherwise StP
  // (this matches your rule exactly)
  return isReflectionId(id) ? 'reflections.html' : 'stp.html';
}

function parseCSV(text){
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows=[]; let i=0, cur='', inQ=false, row=[];
  function pushCell(){ row.push(cur); cur=''; }
  function pushRow(){ rows.push(row); row=[]; }

  while(i<text.length){
    const c=text[i++];
    if(inQ){
      if(c === '"'){
        if(text[i] === '"'){ cur += '"'; i++; } else { inQ = false; }
      } else { cur += c; }
    }else{
      if(c === '"'){ inQ = true; }
      else if(c === ','){ pushCell(); }
      else if(c === '\n'){ pushCell(); pushRow(); }
      else if(c === '\r'){ /* ignore */ }
      else { cur += c; }
    }
  }
  if(cur !== '' || row.length){ pushCell(); pushRow(); }

  const header = (rows.shift()||[]).map(h=>String(h||'').trim());
  return rows
    .filter(r => r.some(x => String(x).trim().length))
    .map(r => {
      const o={}; header.forEach((h,idx)=>{ o[h] = (r[idx]??'').trim(); });
      return o;
    });
}

function normalizeRefUrl(raw){
  if(!raw) return '';
  const s = String(raw).trim();

  // DOI patterns
  const doiBare = /^10\.\d{4,9}\/\S+$/i;          // 10.xxxx/...
  const doiPref = /^doi:\s*(.+)$/i;               // doi: 10.xxxx/...
  // arXiv patterns
  const arxivBare = /^\d{4}\.\d{4,5}(v\d+)?$/i;   // 2023.01234 or 2023.01234v2
  const arxivPref = /^arxiv:\s*(.+)$/i;           // arXiv: 2023.01234

  if(doiBare.test(s)) return `https://doi.org/${s}`;
  const mD = s.match(doiPref);
  if(mD) return `https://doi.org/${mD[1].trim()}`;

  if(arxivBare.test(s)) return `https://arxiv.org/abs/${s}`;
  const mA = s.match(arxivPref);
  if(mA) return `https://arxiv.org/abs/${mA[1].trim()}`;

  // Accept only http(s) URLs
  try{
    const u = new URL(s);
    if(u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  }catch{ /* not a URL */ }

  return '';
}

function splitRefs(cell){
  return (cell || '')
    .split(/\s*;\s*/).filter(Boolean)
    .map(s => {
      const p = s.split('|').map(x=>x.trim());
      if (p.length === 1) {
        // text-only reference: no link
        return { t: p[0] };
      }
      const [t, rawU, n] = p;
      const url = normalizeRefUrl(rawU);
      const out = { t: t || rawU };
      if (url) out.u = url;   // only set u when valid
      if (n) out.n = n;
      return out;
    });
}

// returns the first non-empty field from a list of possible header names
function getField(row, ...alts){
  for (const k of alts){
    if (k in row && row[k] && String(row[k]).trim() !== '') return row[k];
  }
  return '';
}

function ytIdFromUrl(u){
  if(!u) return '';
  try{
    const url=new URL(u);
    if(url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    return url.searchParams.get('v') || '';
  }catch{ return ''; }
}

function upgradeYouTubeThumb(imgEl, videoUrl){
  const id = ytIdFromUrl(videoUrl);
  if(!id || !imgEl) return;
  const test = new Image();
  test.onload = () => { imgEl.src = `https://img.youtube.com/vi/${id}/maxresdefault.jpg`; };
  // if it 404s, we keep the hqdefault already on the page
  test.src = `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
}

function mapVideoRow(row){
  const id = (row.id||'').trim().replace(/_/g,'-');  // remove .toLowerCase()

  const url = (row.url||'').trim();

  // thumbnail: CSV > YouTube fallback
  const yt  = ytIdFromUrl(url);
  let thumb = (row.thumb||'').trim();
  if(!thumb && yt) thumb = `https://img.youtube.com/vi/${yt}/hqdefault.jpg`;

  return {
    id,
    title: row.title || '',
    url,
    date:  (row.date || '').trim(),
    topics: (row.topics || '').split(';').map(s=>s.trim()).filter(Boolean),
    thumb,
    notes: row.notes || '',
    refs: {
      papers:   splitRefs(getField(row, 'ref_papers','ref_paper','papers','paper','refpaper')),
      books:    splitRefs(getField(row, 'ref_books','ref_book','books','book','refbook')),
      talks:    splitRefs(getField(row, 'ref_talks','ref_talk','talks','talk','reftalk')),
      datasets: splitRefs(getField(row, 'ref_datasets','ref_dataset','datasets','dataset','refdataset')),
      other:    splitRefs(getField(row, 'ref_other','ref_misc','other','misc','refother','refmisc')),
    },
    // IMPORTANT: related is a top-level field, not inside refs
    related: (row.related || '').split(';').map(s=>s.trim()).filter(Boolean)
  };
}


async function loadData(){
  // ---- Load SELF archive into VIDEOS ----
  try {
    // Try JSON first (legacy)
    VIDEOS = await loadJSON('data/videos.json');
    console.log('Loaded videos.json');
  } catch {
    try {
      const csvPath = window.ARCHIVE?.csv || 'data/videos.csv';
      const csv = await loadText(csvPath);
      VIDEOS = parseCSV(csv).map(mapVideoRow);
      console.log('Loaded', csvPath, ':', VIDEOS.length, 'entries');
    } catch {
      console.warn('Using fallback VIDEOS');
      VIDEOS = VIDEOS_FALLBACK;
    }
  }

  // ---- Load OTHER archive (for cross-archive related lookups) ----
  OTHER_VIDEOS = [];
  try {
    const otherCsv = window.ARCHIVE?.otherCsv;
    if(otherCsv){
      const otherTxt = await loadText(otherCsv);
      OTHER_VIDEOS = parseCSV(otherTxt).map(mapVideoRow);
      console.log('Loaded', otherCsv, ':', OTHER_VIDEOS.length, 'entries');
    }
  } catch (e){
    console.warn('Could not load other archive CSV for related lookups:', e);
  }

  // ---- Build cross-archive lookup ----
  ALL_BY_ID = new Map();
  for(const v of [...VIDEOS, ...OTHER_VIDEOS]){
    if(v && v.id) ALL_BY_ID.set(String(v.id), v);
  }

  // ---- Sponsors (unchanged) ----
  try {
    SPONSORS = await loadJSON('data/sponsors.json');
  } catch {
    try {
      const csv = await loadText('data/sponsors.csv');
      SPONSORS = parseCSV(csv);
    } catch {
      console.warn('Using fallback SPONSORS');
      SPONSORS = SPONSORS_FALLBACK;
    }
  }

  renderSponsors('#sponsorbar-top');
}



// Utilities
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const chipsEl = $('#chips');
const gridEl = $('#grid');
const emptyEl = $('#empty');
const qEl = $('#q');
const sortEl = $('#sort');
const countEl = $('#count');
const archiveEl = $('#archive');
const detailEl = $('#detail');
const compactBtn = document.getElementById('compactBtn');
let compactMode = true;  // start compact by default

function uniq(arr){ return [...new Set(arr)] }
function getAllTopics(){ return uniq(VIDEOS.flatMap(v => v.topics||[])).sort((a,b)=>a.localeCompare(b)) }
function todayStr(){ return new Date().toISOString().slice(0,10) }
function activeSponsors(){
  const now = todayStr();
  return (SPONSORS||[]).filter(s => !s.expires || s.expires >= now);
}
function renderSponsors(targetId){
  const el = $(targetId);
  const live = activeSponsors();
  el.innerHTML = '';
  if(!live.length) return;
  const label = document.createElement('span');
  label.className = 'meta';
  label.textContent = 'Supported by';
  el.appendChild(label);
  for(const s of live){
    const a = document.createElement('a'); a.href = s.link; a.target = '_blank'; a.rel = 'noopener'; a.title = (s.disclosure? s.disclosure+': ':'') + s.brand;
    const img = document.createElement('img'); img.alt = s.brand; img.src = s.logo; a.appendChild(img);
    el.appendChild(a);
  }
}

let state = { q: new URLSearchParams(location.search).get('q') || '', topics: new Set(), sort: 'newest' };

function buildChips(){
  chipsEl.innerHTML = '';
  const all = getAllTopics();
  for(const t of all){
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = t;
    b.onclick = () => { state.topics.has(t) ? state.topics.delete(t) : state.topics.add(t); renderArchive(); };
    chipsEl.appendChild(b);
  }
}

function applyFilters(){
  let out = [...VIDEOS];
  if(state.q){
    const q = state.q.toLowerCase();
    out = out.filter(v => (v.title+" "+(v.notes||'')).toLowerCase().includes(q));
  }
  if(state.topics.size){
    out = out.filter(v => v.topics && v.topics.some(t => state.topics.has(t)));
  }
  switch(state.sort){
    case 'newest': out.sort((a,b)=> (b.date||'').localeCompare(a.date||'')); break;
    case 'oldest': out.sort((a,b)=> (a.date||'').localeCompare(b.date||'')); break;
    case 'az': out.sort((a,b)=> (a.title||'').localeCompare(b.title||'')); break;
    case 'za': out.sort((a,b)=> (b.title||'').localeCompare(a.title||'')); break;
  }
  return out;
}


	function renderArchive(){
	  qEl.value = state.q;
	  sortEl.value = state.sort;
	  $$('.chip').forEach(ch => ch.classList.toggle('active', state.topics.has(ch.textContent)));

	  const rows = applyFilters();
	  gridEl.innerHTML = '';
	  for(const v of rows){
		const selfDetail = `${window.ARCHIVE.self}?v=${encodeURIComponent(v.id)}`;

		const card = document.createElement('article');
		card.className = 'card';
		card.innerHTML = `
		  <a class="thumb" href="${selfDetail}">
			<img
			  alt="${v.title}"
			  src="${v.thumb}"
			  loading="lazy"
			  decoding="async"
			  width="640"
			  height="360"
			>
			<span class="badge">${v.date ? new Date(v.date).toLocaleDateString() : ''}</span>
		  </a>
		  <div class="body">
			<div class="titleLine"><a href="${selfDetail}">${v.title}</a></div>
			<div class="meta card-desc">${v.notes || ''}</div>
			<div class="topics">${(v.topics||[]).map(t=>`<span class="topic">${t}</span>`).join('')}</div>
			<div class="actions">
			  <a class="btn" href="${selfDetail}">Sources</a>
			  <a class="btn" href="${v.url}" target="_blank" rel="noopener">Watch on YouTube</a>
			</div>
		  </div>`;
		gridEl.appendChild(card);
	  }

	  countEl.textContent = `${rows.length} video${rows.length===1?'':'s'} shown`;
	  emptyEl.style.display = rows.length ? 'none' : 'block';

	  const params = new URLSearchParams();
	  if(state.q) params.set('q', state.q);
	  if(state.sort !== 'newest') params.set('sort', state.sort);
	  if(state.topics.size) params.set('topics', [...state.topics].join(','));
	  history.replaceState(null, '', params.toString() ? `?${params}` : location.pathname + location.hash);

	  renderSponsors('#sponsorbar-archive');
	}


qEl.addEventListener('input', e => { state.q = e.target.value; renderArchive(); });
sortEl.addEventListener('change', e => { state.sort = e.target.value; renderArchive(); });

if (compactBtn){
  const applyCompact = () => {
    document.documentElement.style.setProperty('--desc-lines', compactMode ? '4' : '8');
    compactBtn.textContent = compactMode ? 'Compact cards' : 'Roomy cards';
  };
  compactBtn.addEventListener('click', () => { compactMode = !compactMode; applyCompact(); });
  applyCompact();
}


// ======= Detail (per‑video references) =======
function getVideoById(id){ return ALL_BY_ID.get(String(id)) || null; }


function jaccard(a, b){
  const A = new Set(a||[]), B = new Set(b||[]);
  if(!A.size && !B.size) return 0;
  let inter = 0; for(const x of A) if(B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

function getRelatedVideos(v, max=4){
  // 1) Manual list first
  const manual = (v.related||[])
    .map(id => getVideoById(id))

    .filter(Boolean);
  if(manual.length) return manual.slice(0, max);

  // 2) Fallback: by topic overlap + mild date boost
  const score = (cand) => {
    if(cand.id === v.id) return -1;
    const sTopics = jaccard(v.topics, cand.topics); // 0..1
    const d = Math.abs(new Date(cand.date||'2000-01-01') - new Date(v.date||'2000-01-01')) / (1000*60*60*24);
    const recencyBoost = Math.max(0, 1 - Math.min(d, 365)/365); // within 1 year boosts a bit
    return sTopics*0.85 + recencyBoost*0.15;
  };
  return [...VIDEOS]
    .sort((a,b)=> score(b) - score(a))
    .filter(x => x.id !== v.id)
    .slice(0, max);
}

function renderRelated(v){
  const host = $('#related');
  host.innerHTML = '';
  if(!v.related?.length) return;
  const section = document.createElement('section');
  const h = document.createElement('h3'); h.textContent = 'Related videos';
  section.appendChild(h);

  const grid = document.createElement('div');
  grid.className = 'related-grid';
  for(const id of v.related){
    const r = getVideoById(id);
    if(!r) continue;
    const card = document.createElement('a');
    card.className = 'related-card';
    card.href = `${pageForId(r.id)}?v=${encodeURIComponent(r.id)}`;

card.innerHTML = `
  <div class="thumb">
    <img
      src="${r.thumb}"
      alt="${r.title}"
      loading="lazy"
      decoding="async"
      width="640"
      height="360"
    >
  </div>
  <div class="body">
    <div class="titleLine">${r.title}</div>
    <div class="meta">${r.date || ''}</div>
  </div>`;
    grid.appendChild(card);
  }
  section.appendChild(grid);
  host.appendChild(section);
}

function renderRefs(v){
  const host = $('#refs');
  host.innerHTML = '';
  const groups = [
    ['papers','Papers'],
    ['books','Books'],
    ['talks','Talks & Lectures'],
    ['datasets','Datasets'],
    ['other','Other']
  ];
  const refs = v.refs || {};
  let any = false;

  for(const [key,label] of groups){
    const items = refs[key] || [];
    if(items.length){
      any = true;

      const sec = document.createElement('section');
      sec.className = 'refgroup';

      const h = document.createElement('h3');
      h.textContent = label;
      sec.appendChild(h);

      const ul = document.createElement('ul');

      // --- this is the corrected inner section ---
      for(const it of items){
        const li = document.createElement('li');

        if(it.u){  // valid link present
          const a = document.createElement('a');
          a.href = it.u;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = it.t || it.u;
          li.appendChild(a);
        } else {  // just plain text
          const span = document.createElement('span');
          span.textContent = it.t || '';
          li.appendChild(span);
        }

        if(it.n){  // optional note
          const note = document.createElement('span');
          note.className = 'meta';
          note.style.marginLeft = '8px';
          note.textContent = `– ${it.n}`;
          li.appendChild(note);
        }

        ul.appendChild(li);
      }
      // --- end of fix ---

      sec.appendChild(ul);
      host.appendChild(sec);
    }
  }

  if(!any){
    const p = document.createElement('p');
    p.className = 'meta';
    p.textContent = 'No references added yet.';
    host.appendChild(p);
  }
}

function showDetail(id){
  const v = getVideoById(id);
  if(!v){ history.pushState(null,'',location.pathname); route(); return; }
  $('#dTitle').textContent = v.title || id;
  $('#dDate').textContent = v.date ? new Date(v.date).toLocaleDateString() : '';
  $('#dTopics').textContent = (v.topics||[]).join(' · ');
  $('#dThumb').src = v.thumb || (ytIdFromUrl(v.url) ? `https://img.youtube.com/vi/${ytIdFromUrl(v.url)}/hqdefault.jpg` : '');
upgradeYouTubeThumb($('#dThumb'), v.url);
  $('#dThumb').alt = v.title || '';
  $('#dBadge').textContent = v.date ? new Date(v.date).toLocaleDateString() : '';
  $('#dWatch').href = v.url || '#';
  $('#dNotes').textContent = v.notes || '';
  renderRefs(v);
  renderRelated(v);
  renderSponsors('#sponsorbar-detail');

  // toggle views
  archiveEl.style.display = 'none';
  //$('#controls').style.display = 'none';
  controls.classList.add('is-hidden');

  detailEl.style.display = 'block';
}

// ======= Navigation & routing =======
function showSection(id){
  archiveEl.style.display = 'none';
  $('#controls').style.display = 'none';
  
  detailEl.style.display = 'none';
  
  
  $('#support').style.display = 'none';
  $('#contact').style.display = 'none';
  $(id).style.display = 'block';
  if(id === '#archive'){ $('#controls').style.display = 'flex'; }
}

function wireStaticLinks(){
  $('#lPatreon').href = SUPPORT_LINKS.patreon;
  $('#lKofi').href = SUPPORT_LINKS.kofi;
  $('#lPaypal').href = SUPPORT_LINKS.paypal;
  $('#lMerch').href = SUPPORT_LINKS.merch;
  const e = CONTACT.email;
  if(e){ const a = $('#bizEmail'); a.href = 'mailto:'+e; a.textContent = e; }
}

function goArchive(){
  history.pushState(null, '', location.pathname + '#archive');
  // Reset basic state; keep it simple for now
  state = { q: '', topics: new Set(), sort: 'newest' };
  controls.classList.remove('is-hidden');


  renderArchive();
  showSection('#archive');
}

function route(){
  const p = new URLSearchParams(location.search);
  const hash = (location.hash || '').replace('#','');

  // Hash routes take precedence over ?v=…
  if(hash === 'support'){
    // ensure we drop ?v=… from the URL
    history.replaceState(null, '', location.pathname + '#support');
    renderSponsors('#sponsorbar-support'); wireStaticLinks(); showSection('#support');
    return;
  }
  if(hash === 'contact'){
    history.replaceState(null, '', location.pathname + '#contact');
    renderSponsors('#sponsorbar-contact'); wireStaticLinks(); showSection('#contact');
    return;
  }

  // Detail route (only if no overriding hash)
  const vid = p.get('v');
  if(vid){ showDetail(vid); return; }

  // Default: archive view (respect query params)
  const topics = (p.get('topics')||'').split(',').filter(Boolean);
  if(topics.length) state.topics = new Set(topics);
  const sort = p.get('sort');
  if(sort) state.sort = sort;
  state.q = p.get('q') || '';
  renderArchive();
  showSection('#archive');
}

window.addEventListener('hashchange', route);

// ======= ID Validator & self-tests =======
function validateVideoIDs(list){
  const seen = new Set();
	const pattern = /^(REF-)?[0-9]{8}(-[A-Za-z0-9]+)*$/;

  for(const v of list){
    if(!v.id){ console.warn('❌ Missing id in', v.title); continue; }
    if(seen.has(v.id)) console.warn('⚠️ Duplicate id:', v.id);
    seen.add(v.id);
    if(!pattern.test(v.id)) console.warn('⚠️ Invalid id format:', v.id, 'Expected YYYYMMDD-suffix');
    if(v.id.length>48) console.warn('⚠️ ID very long:', v.id);
  }
  if(!list.length) console.warn('⚠️ No videos found');
  else console.log('✅ ID validation complete:', list.length, 'entries');
}


let sponsorPulseTimer = null;

function startSponsorBreathing() {
  // Accessibility: don't animate if user prefers reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const bar = document.querySelector('#sponsorbar-top');
  if (!bar) return;

  // clear any old interval (in case we re-rendered)
  if (sponsorPulseTimer) clearInterval(sponsorPulseTimer);

  const pulse = () => {
    const imgs = Array.from(bar.querySelectorAll('img'));
    if (!imgs.length) return;
    const el = imgs[Math.floor(Math.random() * imgs.length)];
    // restart animation by toggling the class
    el.classList.remove('sponsor-breathe');
    // force reflow so the animation can replay
    void el.offsetWidth;
    el.classList.add('sponsor-breathe');
  };

  // fire occasionally; first after a short delay so page settles
  setTimeout(pulse, 1500);
  sponsorPulseTimer = setInterval(pulse, 15000);
}

const navSwitch = document.getElementById('navSwitch');

if (navSwitch) {
  const isRef = window.ARCHIVE?.self === 'reflections.html';

  navSwitch.textContent = isRef ? '⇄ See The Pattern' : '⇄ Reflections';
  navSwitch.title = isRef
    ? 'Go to See The Pattern archive'
    : 'Go to Reflections archive';

  navSwitch.addEventListener('click', e => {
    e.preventDefault();
    window.location.href = window.ARCHIVE.other + '#archive';
  });
}


function otherArchivePage(){
  return window.ARCHIVE?.other || (window.ARCHIVE?.self === 'reflections.html' ? 'stp.html' : 'reflections.html');
}

function switchArchive(){
  window.location.href = otherArchivePage() + '#archive';
}


// ======= Init =======
loadData()
  .then(()=>{
    validateVideoIDs(VIDEOS);
    buildChips();
    renderSponsors('#sponsorbar-top');   // existing
    startSponsorBreathing();             // ← add this
    route();
  })
  .catch(e=>{
    console.error('Data load failed', e);
    if (!VIDEOS.length) VIDEOS = VIDEOS_FALLBACK;
    if (!SPONSORS.length) SPONSORS = SPONSORS_FALLBACK;
    validateVideoIDs(VIDEOS);
    buildChips();
    renderSponsors('#sponsorbar-top');
    startSponsorBreathing();             // ← add here too
    route();
  });


// Client-side Archive navigation to avoid sandbox navigation blocks
const navArchive = document.getElementById('navArchive');
if(navArchive){ navArchive.addEventListener('click', (e)=>{ e.preventDefault(); goArchive(); }); }
const backArchive = document.getElementById('backArchive');
if(backArchive){ backArchive.addEventListener('click', (e)=>{ e.preventDefault(); goArchive(); }); }


// Support nav
const navSupport = document.querySelector('a[href="#support"]');
if (navSupport) {
  navSupport.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState(null, '', location.pathname + '#support');
    route();
  });
}

// Contact nav
const navContact = document.querySelector('a[href="#contact"]');
if (navContact) {
  navContact.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState(null, '', location.pathname + '#contact');
    route();
  });
}

// Tiny export helper (exports current in-memory VIDEOS)
// Guard against pages where #export does not exist
const exportBtn = $('#export');
if (exportBtn) {
  exportBtn.addEventListener('click', e =>{
    e.preventDefault();
    const blob = new Blob([JSON.stringify(VIDEOS, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {href:url, download:'videos.json'});
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),500);
  });
}
