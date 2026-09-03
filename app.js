const SUPABASE_URL = 'https://sbimesnrwrxgkqkfhiaz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ASbg_BcoGRlcJLwsFX7utw_4hTFpBmp';
const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);

const KS='fpV4store', KC='fpV4code', KD='fpV4departments', KN='fpV4notifications', KM='fpV43magasinId';
let products=[], catalogue=[], scanner=false, last='', dailyMode='today', filter='all', magasinId=localStorage.getItem(KM)||null, syncTimer=null;
const $=x=>document.getElementById(x), $$=s=>[...document.querySelectorAll(s)];
const iso=d=>{let x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,10)};
const add=(d,n)=>{let x=new Date(d);x.setDate(x.getDate()+n);return x};
const today=()=>new Date(new Date().setHours(0,0,0,0));
const fmt=d=>new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(d));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

function toast(x){let t=$('toast'); if(!t)return; t.textContent=x;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function setSync(text,ok=false){let x=$('syncState');if(x){x.textContent=text;x.className='syncState '+(ok?'ok':'')}}
function icon(dep){return({'Crèmerie':'🥛','Charcuterie':'🥓','Frais':'🥬','Traiteur':'🍗','Épicerie':'🧀','Boucherie':'🥩','Poissonnerie':'🐟'})[dep]||'🥫'}
function status(p){if(p.done)return['Retiré','green'];let diff=Math.round((new Date(p.expiry+'T00:00:00')-today())/86400000);if(diff<=0)return["À retirer aujourd'hui",'red'];if(diff===1)return['Demain','orange'];return['Cette semaine','green']}
function inWeek(p){let d=new Date(p.expiry+'T00:00:00'),t=today(),e=add(t,6);return d>=t&&d<=e}
function arr(mode){let t=iso(today()),tm=iso(add(today(),1));return products.filter(p=>!p.done&&(mode==='today'?p.expiry<=t:mode==='tomorrow'?p.expiry===tm:mode==='week'?inWeek(p):true))}
function qty(a){return a.reduce((n,p)=>n+(+p.quantity||1),0)}

function mapRow(r){return {id:r.id,name:r.nom,barcode:r.code_barres||'',quantity:r.quantite||1,expiry:r.dlc,department:r.rayon||'Frais',note:r.notes||'',done:!!r.retire,doneAt:r.retire_at||null}}
async function ensureAnonSession(){
  if(!db) throw new Error('Supabase indisponible');
  const current=await db.auth.getSession();
  if(current?.data?.session) return current.data.session;
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    const {data,error}=await db.auth.signInAnonymously();
    if(!error && data?.session) return data.session;
    lastError=error||new Error('Session anonyme non créée');
    if(attempt<3) await new Promise(r=>setTimeout(r,1200*attempt));
  }
  throw lastError;
}
function deviceLabel(){let ua=navigator.userAgent||''; if(/iPhone/i.test(ua))return 'iPhone'; if(/iPad/i.test(ua))return 'iPad'; if(/Android/i.test(ua))return 'Android'; return 'Téléphone'}
async function connectStore(code){
  setSync('Connexion…');
  await ensureAnonSession();
  const {data,error}=await db.rpc('rejoindre_magasin',{p_code:code,p_appareil:deviceLabel()});
  if(error) throw error;
  magasinId=String(data);
  localStorage.setItem(KM,magasinId);localStorage.setItem(KC,code);localStorage.setItem(KS,'Proxi - Monéteau');
  await loadProducts();
  setSync('Connecté à Proxi - Monéteau',true);
  startSyncTimer();
}
async function loadProducts(silent=false){
  if(!db||!magasinId)return;
  const {data,error}=await db.from('produits').select('*').eq('magasin_id',magasinId).order('dlc',{ascending:true}).order('created_at',{ascending:true});
  if(error){if(!silent)toast('Synchronisation impossible');console.error(error);return}
  products=(data||[]).map(mapRow);render();
}
function startSyncTimer(){if(syncTimer)clearInterval(syncTimer);syncTimer=setInterval(()=>loadProducts(true),8000)}
async function addProductRemote(p){
  const {error}=await db.from('produits').insert({magasin_id:+magasinId,nom:p.name,code_barres:p.barcode||null,quantite:p.quantity,dlc:p.expiry,rayon:p.department,notes:p.note||null,retire:false});
  if(error)throw error; await loadProducts(true);
}

async function findCatalogueProduct(code){
  if(!db||!magasinId||!code)return null;
  const {data,error}=await db.from('catalogue_produits').select('*').eq('magasin_id',magasinId).eq('code_barres',code).maybeSingle();
  if(error){
    if(/catalogue_produits|does not exist|schema cache/i.test(error.message||'')) return null;
    console.warn('Catalogue:',error);
    return null;
  }
  return data||null;
}
function guessDepartment(p){
  const txt=((p.categories||'')+' '+((p.categories_tags||[]).join(' '))).toLowerCase();
  if(/milk|dairy|cheese|yog|yaourt|cream|crème|fromage|lait/.test(txt))return 'Crèmerie';
  if(/charcut|ham|jambon|sausage|saucisson|pork|porc/.test(txt))return 'Charcuterie';
  if(/fish|seafood|poisson|saumon|thon|crevette/.test(txt))return 'Poissonnerie';
  if(/meat|beef|boeuf|bœuf|steak|veau|agneau/.test(txt))return 'Boucherie';
  if(/prepared|ready meal|meal|traiteur|pizza|sandwich/.test(txt))return 'Traiteur';
  if(/fruit|vegetable|salad|salade|tomato|tomate|fresh/.test(txt))return 'Frais';
  return 'Épicerie';
}
async function lookupOpenFoodFacts(code){
  try{
    const url='https://world.openfoodfacts.org/api/v2/product/'+encodeURIComponent(code)+'.json?fields=code,product_name,product_name_fr,brands,quantity,categories,categories_tags';
    const r=await fetch(url,{headers:{'Accept':'application/json'}});
    if(!r.ok)return null;
    const j=await r.json();
    if(j.status!==1||!j.product)return null;
    const p=j.product;
    const name=(p.product_name_fr||p.product_name||'').trim();
    if(!name)return null;
    return {nom:name,marque:(p.brands||'').trim(),rayon:guessDepartment(p),notes:(p.quantity||'').trim(),source:'openfoodfacts'};
  }catch(e){console.warn('Open Food Facts:',e);return null}
}
async function rememberCatalogueProduct(p){
  if(!db||!magasinId||!p.barcode||!p.name)return;
  const payload={magasin_id:+magasinId,code_barres:p.barcode,nom:p.name,marque:'',rayon:p.department||null,notes:p.note||null,source:'magasin',updated_at:new Date().toISOString()};
  const {error}=await db.from('catalogue_produits').upsert(payload,{onConflict:'magasin_id,code_barres'});
  if(error&&!/catalogue_produits|does not exist|schema cache/i.test(error.message||''))console.warn('Enregistrement catalogue:',error);
}
async function identifyBarcode(code){
  $('barcode').value=code;
  $('scanStatus').textContent='Recherche du produit…';
  const local=await findCatalogueProduct(code);
  if(local){
    $('name').value=local.nom||'';
    if(local.rayon){const opts=[...$('department').options].map(o=>o.value);if(opts.includes(local.rayon))$('department').value=local.rayon}
    if(local.notes)$('note').value=local.notes;
    toast('Produit reconnu : '+(local.nom||code));
    show('addView');
    return;
  }
  const off=await lookupOpenFoodFacts(code);
  if(off){
    $('name').value=off.nom;
    const opts=[...$('department').options].map(o=>o.value);if(opts.includes(off.rayon))$('department').value=off.rayon;
    const extras=[off.marque,off.notes].filter(Boolean).join(' · ');if(extras)$('note').value=extras;
    toast('Produit reconnu automatiquement');
  }else{
    $('name').value='';
    toast('Produit inconnu : entrez son nom une fois');
  }
  show('addView');
}
async function setDoneRemote(id,done){
  const payload={retire:done};
  if(done)payload.retire_at=new Date().toISOString(); else payload.retire_at=null;
  let {error}=await db.from('produits').update(payload).eq('id',id).eq('magasin_id',magasinId);
  if(error && /retire_at/i.test(error.message||'')){
    delete payload.retire_at;
    ({error}=await db.from('produits').update(payload).eq('id',id).eq('magasin_id',magasinId));
  }
  if(error)throw error; await loadProducts(true);
}

function show(id){
  stopScan();$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===id));
  if(id==='scanView')setTimeout(startScan,200);
  if(id==='storeSettingsView'){$('storePageInput').value='Proxi - Monéteau';$('storeCodeInput').value=localStorage.getItem(KC)||'582941'}
  if(id==='employeesView')$('codeDisplayPage').textContent=localStorage.getItem(KC)||'582941';
  if(id==='departmentsView')renderDepartments();if(id==='notificationsView')loadNotifications();if(id==='catalogueView')loadCatalogue();render();
}
function productHTML(p,check=false){let[s,c]=status(p);return `<div class="product"><div class="picon">${icon(p.department)}</div><div class="pinfo"><b>${esc(p.name)}</b><span class="badge ${c}">${s}</span><small>${fmt(p.expiry)} · ♧ ${esc(p.department)}</small></div><span class="qtyText">${p.quantity>1?'x'+p.quantity:''}</span>${check?`<button class="check ${p.done?'done':''}" data-done="${p.id}">${p.done?'✓':''}</button>`:'›'}</div>`}
function render(){
  let t=today();if($('currentDate'))$('currentDate').textContent=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(t);
  if($('todayCount'))$('todayCount').textContent=qty(arr('today'));if($('tomorrowCount'))$('tomorrowCount').textContent=qty(arr('tomorrow'));if($('weekCount'))$('weekCount').textContent=qty(arr('week'));
  let names=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];if($('upcoming'))$('upcoming').innerHTML=[0,1,2,3,4].map(n=>{let d=add(t,n),c=qty(products.filter(p=>!p.done&&p.expiry===iso(d)));return `<div class="day ${n===0?'today':''}"><b>${names[d.getDay()]}</b><strong>${d.getDate()}</strong><span>${c||'0'}</span></div>`}).join('');
  let q=($('search')?.value||'').toLowerCase();let ps=products.filter(p=>p.name.toLowerCase().includes(q));if(filter!=='all')ps=ps.filter(p=>arr(filter).some(x=>x.id===p.id));if($('productList'))$('productList').innerHTML=ps.length?ps.map(p=>productHTML(p)).join(''):'<div class="card">Aucun produit.</div>';
  renderStats();if($('settingsStore'))$('settingsStore').textContent='Proxi - Monéteau';if($('storeName'))$('storeName').textContent='Proxi - Monéteau';
}
function openDaily(m){dailyMode=m;let a=arr(m),d=m==='today'?today():add(today(),1);$('dailyTitle').textContent=m==='today'?"À retirer aujourd'hui":'À surveiller demain';$('dailyCount').textContent=qty(a)+' produits';$('dailyDate').textContent='▣ '+new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(d);$('dailyList').innerHTML=a.length?a.map(p=>productHTML(p,true)).join(''):'<div class="card">Aucun produit 🎉</div>';show('dailyView')}
function renderStats(){
  if(!$('removedStat'))return;let week=arr('week'),removed=products.filter(p=>p.done);$('removedStat').textContent=qty(removed);$('pendingStat').textContent=qty(week);$('lossStat').textContent='-'+(qty(removed)*0.5).toFixed(2).replace('.',',')+'€';$('weekText').textContent='Semaine du '+fmt(today())+' au '+fmt(add(today(),6));
  let groups={};products.forEach(p=>groups[p.department]=(groups[p.department]||0)+(+p.quantity||1));let max=Math.max(1,...Object.values(groups));$('departmentStats').innerHTML=Object.entries(groups).map(([k,v])=>`<div class="barRow"><div class="barTop"><span>${k}</span><b>${v}</b></div><div class="bar"><i style="width:${v/max*100}%"></i></div></div>`).join('')||'<small>Aucune donnée.</small>';
  $('history').innerHTML=removed.slice(-5).reverse().map(p=>`<div class="hist"><span>🔴 ${p.doneAt?fmt(p.doneAt):'Retiré'}</span><b>${p.quantity} produit(s)</b></div>`).join('')||'<small>Aucun retrait.</small>';
}

async function loadCatalogue(){
  if(!db||!magasinId)return;
  const {data,error}=await db.from('catalogue_produits').select('*').eq('magasin_id',magasinId).order('nom',{ascending:true});
  if(error){console.error(error);toast('Catalogue indisponible');return}
  catalogue=data||[];renderCatalogue();
}
function renderCatalogue(){
  if(!$('catalogueList'))return;
  const q=($('catalogueSearch')?.value||'').trim().toLowerCase();
  const rows=catalogue.filter(x=>(x.nom||'').toLowerCase().includes(q)||(x.code_barres||'').includes(q));
  $('catalogueCount').textContent=catalogue.length;
  $('catalogueList').innerHTML=rows.length?rows.map(x=>`<button class="catalogueItem" data-cat-id="${x.id}"><span class="eanIcon"><svg class="eanSvg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v14M7 5v14M10 5v14M14 5v14M17 5v14M20 5v14"/></svg></span><span class="catInfo"><b>${esc(x.nom)}</b><small>EAN ${esc(x.code_barres)}${x.rayon?' · '+esc(x.rayon):''}</small></span><span class="chev">›</span></button>`).join(''):'<div class="card emptyCatalogue"><strong>Aucune référence trouvée</strong><span>Ajoutez un EAN pour qu’il soit reconnu au scan.</span></div>';
}
function fillCatalogueDepartments(selected=''){
  const sel=$('catalogueDepartment');if(!sel)return;const deps=getDepartments();sel.innerHTML='<option value="">Non renseigné</option>'+deps.map(x=>`<option>${esc(x)}</option>`).join('');if(selected)sel.value=selected;
}
function openCatalogueEditor(row=null){
  $('catalogueId').value=row?.id||'';$('catalogueBarcode').value=row?.code_barres||'';$('catalogueName').value=row?.nom||'';$('catalogueNotes').value=row?.notes||'';fillCatalogueDepartments(row?.rayon||'');$('catalogueEditTitle').textContent=row?'Modifier la référence':'Ajouter une référence';$('deleteCatalogueBtn').classList.toggle('hidden',!row);show('catalogueEditView');
}

function startScan(){
  if(scanner||!window.Quagga){$('scanStatus').textContent='Scanner indisponible. Utilisez la saisie manuelle.';return}
  $('scanStatus').textContent='Placez le code-barres bien droit dans le cadre.';
  Quagga.init({inputStream:{name:'Live',type:'LiveStream',target:$('reader'),constraints:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}},area:{top:'5%',right:'3%',left:'3%',bottom:'5%'}},locator:{patchSize:'large',halfSample:false},numOfWorkers:navigator.hardwareConcurrency||4,frequency:15,decoder:{readers:['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader','code_39_reader']},locate:true},err=>{if(err){$('scanStatus').textContent='Impossible d’ouvrir la caméra.';return}scanner=true;Quagga.start()});
  Quagga.offDetected(onDetected);Quagga.onDetected(onDetected);
}
function onDetected(r){let code=r?.codeResult?.code;if(!code||code===last)return;last=code;navigator.vibrate?.(80);stopScan();identifyBarcode(code)}
function stopScan(){if(scanner&&window.Quagga){try{Quagga.stop()}catch(e){}scanner=false}}

$('startBtn').onclick=()=>{$('welcome').classList.add('hidden');$('login').classList.remove('hidden');$('shopCode').value=localStorage.getItem(KC)||'582941'};
$('loginBtn').onclick=async()=>{let c=$('shopCode').value.trim();if(c.length<4)return toast('Entrez le code magasin');$('loginBtn').disabled=true;try{await connectStore(c);$('login').classList.add('hidden');$('app').classList.remove('hidden');render();toast('Magasin connecté')}catch(e){console.error('Connexion Frais Proxi:',e);const msg=(e?.message||'Connexion impossible').trim();setSync(msg);if(/anonymous sign-ins are disabled/i.test(msg))toast('Connexion anonyme non encore active côté Supabase');else if(/invalid|code magasin|incorrect/i.test(msg))toast('Code magasin incorrect');else toast('Connexion impossible : '+msg.slice(0,80))}finally{$('loginBtn').disabled=false}};
$$('[data-view]').forEach(b=>b.onclick=()=>show(b.dataset.view));$$('[data-daily]').forEach(b=>b.onclick=()=>openDaily(b.dataset.daily));$('addBtn').onclick=()=>show('addView');$('scanTab').onclick=()=>show('scanView');$('minus').onclick=()=>{$('quantity').value=Math.max(1,+$('quantity').value-1)};$('plusQty').onclick=()=>{$('quantity').value=+$('quantity').value+1};
$('productForm').onsubmit=async e=>{e.preventDefault();if(!magasinId)return toast('Reconnectez le magasin');let p={name:$('name').value.trim(),quantity:+$('quantity').value,expiry:$('expiry').value,department:$('department').value,note:$('note').value.trim(),barcode:$('barcode').value};try{await addProductRemote(p);await rememberCatalogueProduct(p);e.target.reset();$('quantity').value=1;$('expiry').value=iso(today());toast('Produit ajouté et mémorisé');show('homeView')}catch(err){console.error(err);toast('Impossible d’ajouter le produit')}};
$('search').oninput=render;$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render()});
document.addEventListener('click',async e=>{let b=e.target.closest('[data-done]');if(!b)return;let p=products.find(x=>x.id==b.dataset.done);if(!p)return;try{await setDoneRemote(p.id,!p.done);openDaily(dailyMode);toast(p.done?'Produit remis en attente':'Produit retiré')}catch(err){console.error(err);toast('Modification impossible')}});
$('doneAll').onclick=async()=>{let a=arr(dailyMode);try{for(const p of a)await setDoneRemote(p.id,true);toast('Tout est retiré');openDaily(dailyMode)}catch(e){toast('Une erreur est survenue')}};
$('manualBarcodeBtn').onclick=()=>{let c=prompt('Numéro sous le code-barres :');if(c){stopScan();identifyBarcode(c.trim())}};
$('teamBtn').onclick=()=>show('employeesView');$('menuBtn').onclick=()=>show('settingsView');
$('exportBtn').onclick=()=>{let blob=new Blob([JSON.stringify({store:'Proxi - Monéteau',products},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='frais-proxi-v5.2.json';a.click()};
function getDepartments(){try{return JSON.parse(localStorage.getItem(KD)||'null')||['Crèmerie','Charcuterie','Frais','Traiteur','Épicerie','Boucherie','Poissonnerie']}catch(e){return['Crèmerie','Charcuterie','Frais','Traiteur','Épicerie','Boucherie','Poissonnerie']}}
function saveDepartments(a){localStorage.setItem(KD,JSON.stringify(a));refreshDepartmentSelect()}
function refreshDepartmentSelect(){let a=getDepartments(),sel=$('department'),cur=sel.value;sel.innerHTML=a.map(x=>`<option>${esc(x)}</option>`).join('');if(a.includes(cur))sel.value=cur}
function renderDepartments(){let a=getDepartments();$('departmentList').innerHTML=a.map((x,i)=>`<div class="departmentRow"><span>${esc(x)}</span><button data-del-dep="${i}" aria-label="Supprimer">×</button></div>`).join('')}
function loadNotifications(){let n={today:true,tomorrow:true,days:1};try{n={...n,...JSON.parse(localStorage.getItem(KN)||'{}')}}catch(e){}$('notifToday').checked=n.today;$('notifTomorrow').checked=n.tomorrow;if($('notifDays'))$('notifDays').value=String(n.days||1)}
$('saveStorePage').onclick=()=>{localStorage.setItem(KS,'Proxi - Monéteau');let code=$('storeCodeInput').value.trim();if(code)localStorage.setItem(KC,code);render();toast('Informations enregistrées')};
$('addDepartment').onclick=()=>{let v=$('newDepartment').value.trim();if(!v)return;let a=getDepartments();if(!a.some(x=>x.toLowerCase()===v.toLowerCase()))a.push(v);saveDepartments(a);$('newDepartment').value='';renderDepartments();toast('Rayon ajouté')};
document.addEventListener('click',e=>{let b=e.target.closest('[data-del-dep]');if(!b)return;let a=getDepartments();if(a.length<=1)return toast('Gardez au moins un rayon');a.splice(+b.dataset.delDep,1);saveDepartments(a);renderDepartments();toast('Rayon supprimé')});
$('saveNotifications').onclick=()=>{localStorage.setItem(KN,JSON.stringify({today:$('notifToday').checked,tomorrow:$('notifTomorrow').checked,days:+($('notifDays')?.value||1)}));toast('Notifications enregistrées')};
$('importFile').onchange=e=>{toast('Import local désactivé avec la synchronisation en ligne')};

$('catalogueSearch').oninput=renderCatalogue;
$('refreshCatalogue').onclick=()=>loadCatalogue();
$('newCatalogueBtn').onclick=()=>openCatalogueEditor();
document.addEventListener('click',e=>{const b=e.target.closest('[data-cat-id]');if(!b)return;const row=catalogue.find(x=>String(x.id)===String(b.dataset.catId));if(row)openCatalogueEditor(row)});
$('catalogueForm').onsubmit=async e=>{e.preventDefault();if(!magasinId)return toast('Reconnectez le magasin');const id=$('catalogueId').value;const payload={magasin_id:+magasinId,code_barres:$('catalogueBarcode').value.trim(),nom:$('catalogueName').value.trim(),rayon:$('catalogueDepartment').value||null,notes:$('catalogueNotes').value.trim()||null,source:'magasin',updated_at:new Date().toISOString()};let res=id?await db.from('catalogue_produits').update(payload).eq('id',id).eq('magasin_id',magasinId):await db.from('catalogue_produits').upsert(payload,{onConflict:'magasin_id,code_barres'});if(res.error){console.error(res.error);return toast('Impossible d’enregistrer')}toast('Référence enregistrée');await loadCatalogue();show('catalogueView')};
$('deleteCatalogueBtn').onclick=async()=>{const id=$('catalogueId').value;if(!id)return;if(!confirm('Supprimer cette référence du catalogue ?'))return;const {error}=await db.from('catalogue_produits').delete().eq('id',id).eq('magasin_id',magasinId);if(error)return toast('Suppression impossible');toast('Référence supprimée');await loadCatalogue();show('catalogueView')};

refreshDepartmentSelect();fillCatalogueDepartments();$('expiry').value=iso(today());render();
window.addEventListener('focus',()=>loadProducts(true));window.addEventListener('beforeunload',stopScan);

(async()=>{
  try{
    if(!db)return;
    const {data:{session}}=await db.auth.getSession();
    if(session && magasinId){$('welcome').classList.add('hidden');$('login').classList.add('hidden');$('app').classList.remove('hidden');await loadProducts(true);startSyncTimer();render()}
  }catch(e){console.error(e)}
})();
