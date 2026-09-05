const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':'&quot;'}[c]));
const t = v => window.I18N?.t(v)||v;const fmtDate = d => d ? new Intl.DateTimeFormat(window.I18N?.lang||'pt-BR',{dateStyle:'medium'}).format(new Date(`${d}T12:00:00`)) : '';
const img = (url, alt, cls='card-media') => url ? `<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy">` : `<div class="${cls}" style="display:grid;place-items:center;color:#666">ABTT</div>`;
function empty(text){return `<div class="empty">${esc(text)}</div>`}
async function load(){
  try{
    const r=await fetch(`/api/content?lang=${encodeURIComponent(window.I18N?.lang||'pt-BR')}`); if(!r.ok) throw new Error(); const d=await r.json();
    $('#athletesCount').textContent=`${d.athletes.length} ${t(d.athletes.length===1?'atleta':'atletas')}`;
    $('#athletesGrid').innerHTML=d.athletes.map(x=>`<article class="card athlete-card">${img(x.url,x.name)}<div class="card-body"><h3>${esc(x.name)}</h3><p>${esc([x.belt&&`${t('Faixa')} ${x.belt}`,x.degree,x.country].filter(Boolean).join(' • '))}</p>${x.age?`<div class="card-meta">${esc(x.age)} ${t('anos')}</div>`:''}</div></article>`).join('')||empty(t('Nenhum atleta cadastrado ainda.'));
    $('#newsGrid').innerHTML=d.news.map(x=>`<article class="card">${img(x.url,x.title)}<div class="card-body"><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></div></article>`).join('')||empty(t('Nenhuma notícia publicada ainda.'));
    $('#eventsGrid').innerHTML=d.events.map(x=>`<article class="card">${img(x.url,x.title)}<div class="card-body"><h3>${esc(x.title)}</h3><div class="card-meta">${fmtDate(x.event_date)}</div></div></article>`).join('')||empty(t('Nenhum evento cadastrado ainda.'));
    $('#affiliatesGrid').innerHTML=d.affiliates.map(x=>`<article class="card">${img(x.url,x.name)}<div class="card-body"><h3>${esc(x.name)}</h3><p>${esc(x.city)} • ${esc(x.country)}</p>${x.coach?`<div class="card-meta">${t('Prof.')} ${esc(x.coach)}</div>`:''}</div></article>`).join('')||empty(t('Nenhuma afiliada cadastrada ainda.'));
    $('#mediaGrid').innerHTML=d.media.map(x=>`<article class="card">${x.type==='video'?`<video class="card-media" controls preload="metadata" src="${esc(x.url)}"></video>`:img(x.url,x.title)}<div class="card-body"><h3>${esc(x.title)}</h3></div></article>`).join('')||empty(t('Nenhuma mídia cadastrada ainda.'));
  }catch{document.querySelectorAll('#athletesGrid,#newsGrid,#eventsGrid,#affiliatesGrid,#mediaGrid').forEach(x=>x.innerHTML=empty(t('Não foi possível carregar o conteúdo.')));}
}
$('#menuBtn').addEventListener('click',()=>{const n=$('#navLinks');n.classList.toggle('open');$('#menuBtn').setAttribute('aria-expanded',n.classList.contains('open'))});
document.querySelectorAll('#navLinks a').forEach(a=>a.addEventListener('click',()=>$('#navLinks').classList.remove('open')));
$('#year').textContent=new Date().getFullYear();document.addEventListener('abtt:languagechange',load);load();
