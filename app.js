const SUPABASE_URL = 'https://sbimesnrwrxgkqkfhiaz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ASbg_BcoGRlcJLwsFX7utw_4hTFpBmp';
const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);

const KS='fpV4store', KC='fpV4code', KD='fpV4departments', KN='fpV4notifications', KM='fpV43magasinId', KP='fpV55products', KQ='fpV55queue', KCAT='fpV55catalogue', KDEVICE='fpV552deviceId';
let products=JSON.parse(localStorage.getItem(KP)||'[]'), catalogue=JSON.parse(localStorage.getItem(KCAT)||'[]'), departments=['Crèmerie','Charcuterie','Frais','Traiteur','Épicerie','Boucherie','Poissonnerie'], employees=[], currentAccess=null, scanner=false, last='', dailyMode='today', filter='all', magasinId=localStorage.getItem(KM)||null, syncTimer=null;
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

function catalogueMeta(code){return catalogue.find(x=>String(x.code_barres||'')===String(code||''))||null}
function looksLikeBarcodeName(name,code){const n=String(name||'').trim(),c=String(code||'').trim();return !n||(c&&n===c)||(/^\d{8,14}$/.test(n))}
function mapRow(r){const code=r.code_barres||'',cat=catalogueMeta(code);return {id:r.id,name:(cat?.nom&&looksLikeBarcodeName(r.nom,code))?cat.nom:(r.nom||cat?.nom||code||'Produit'),barcode:code,quantity:r.quantite||1,expiry:r.dlc,department:cat?.rayon||r.rayon||'Frais',note:r.notes||cat?.notes||'',done:!!r.retire,doneAt:r.retire_at||null}}
function saveLocal(){localStorage.setItem(KP,JSON.stringify(products))}
function queue(op){let q=JSON.parse(localStorage.getItem(KQ)||'[]');q.push(op);localStorage.setItem(KQ,JSON.stringify(q))}
async function flushQueue(){if(!navigator.onLine||!db||!magasinId)return;let q=JSON.parse(localStorage.getItem(KQ)||'[]'),left=[];for(const op of q){try{if(op.type==='insert')await addProductRemote(op.p,true);else if(op.type==='delete'){let {error}=await db.from('produits').delete().eq('id',op.id).eq('magasin_id',magasinId);if(error)throw error}else if(op.type==='update'){let {error}=await db.from('produits').update(op.payload).eq('id',op.id).eq('magasin_id',magasinId);if(error)throw error}}catch(e){left.push(op)}}localStorage.setItem(KQ,JSON.stringify(left));if(!left.length)await loadProducts(true)}
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
function deviceId(){let id=localStorage.getItem(KDEVICE);if(!id){id=(crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()+'-'+Math.random().toString(36).slice(2));localStorage.setItem(KDEVICE,id)}return id}
function isAdmin(){return currentAccess?.role==='admin'&&currentAccess?.actif!==false}
async function loadMyAccess(){
  if(!db||!magasinId)return null;
  const {data:{session}}=await db.auth.getSession();
  if(!session)return null;
  const {data,error}=await db.from('acces_magasin').select('*').eq('magasin_id',magasinId).eq('user_id',session.user.id).maybeSingle();
  if(error){console.warn('Accès:',error);return null}
  currentAccess=data||null;applyRoleUI();return currentAccess;
}
function applyRoleUI(){
  const admin=isAdmin();
  const pill=$('currentRolePill');if(pill)pill.textContent=admin?'Administrateur':'Employé';
  $$('[data-admin-only="true"]').forEach(x=>x.classList.toggle('adminHidden',!admin));
  if($('storeCodeCard'))$('storeCodeCard').classList.toggle('adminHidden',!admin);
}
async function loadEmployees(){
  if(!db||!magasinId)return;
  const {data,error}=await db.from('acces_magasin').select('*').eq('magasin_id',magasinId);
  if(error){console.error(error);toast('Accès équipe indisponibles');return}
  employees=data||[];renderEmployees();
}
function renderEmployees(){
  if(!$('employeeList'))return;
  const admin=isAdmin();
  $('employeeCount').textContent=String(employees.filter(x=>x.actif!==false).length);
  $('employeeList').innerHTML=employees.length?employees.map(x=>{
    const label=x.nom_affichage||x.appareil||'Appareil';
    const role=x.role==='admin'?'Administrateur':'Employé';
    const active=x.actif!==false;
    return `<div class="employeeManageRow ${active?'':'disabled'}"><span class="avatarCircle"><svg class="settingsIcon" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span><div class="employeeMeta"><b>${esc(label)}</b><small>${active?'Accès actif':'Accès désactivé'}</small></div><span class="rolePill small">${role}</span>${admin?`<button class="employeeAction" data-employee-role="${esc(x.user_id)}" data-current-role="${esc(x.role||'employe')}" title="Changer le rôle">⇄</button><button class="employeeAction" data-employee-active="${esc(x.user_id)}" data-current-active="${active?'1':'0'}" title="Activer ou désactiver">${active?'⊘':'✓'}</button>`:''}</div>`
  }).join(''):'<p class="muted">Aucun accès trouvé.</p>';
}
async function loadDepartmentsRemote(){
  if(!db||!magasinId){refreshDepartmentSelect();return}
  const {data,error}=await db.from('rayons').select('*').eq('magasin_id',magasinId).eq('actif',true).order('position',{ascending:true}).order('nom',{ascending:true});
  if(!error&&data?.length)departments=data.map(x=>x.nom);
  refreshDepartmentSelect();fillCatalogueDepartments();
}
async function connectStore(code){
  setSync('Connexion…');
  await ensureAnonSession();
  const {data,error}=await db.rpc('rejoindre_magasin_v552',{p_code:code,p_appareil:deviceLabel(),p_device_id:deviceId()});
  if(error) throw error;
  magasinId=String(data);
  localStorage.setItem(KM,magasinId);localStorage.setItem(KC,code);localStorage.setItem(KS,'Proxi - Monéteau');
  await loadMyAccess();
  if(currentAccess?.actif===false) throw new Error('Cet accès a été désactivé par un administrateur');
  await loadDepartmentsRemote();
  await loadCatalogue();
  await loadProducts();
  setSync('Connecté à Proxi - Monéteau',true);
  startSyncTimer();
}
async function loadProducts(silent=false){
  if(!db||!magasinId)return;
  const {data,error}=await db.from('produits').select('*').eq('magasin_id',magasinId).order('dlc',{ascending:true}).order('created_at',{ascending:true});
  if(error){if(!silent)toast('Mode hors ligne : données du téléphone');console.error(error);render();return}
  products=(data||[]).map(mapRow);saveLocal();render();
}
function startSyncTimer(){if(syncTimer)clearInterval(syncTimer);syncTimer=setInterval(()=>loadProducts(true),8000)}
async function addProductRemote(p,noReload=false){const {error}=await db.from('produits').insert({magasin_id:+magasinId,nom:p.name,code_barres:p.barcode||null,quantite:p.quantity,dlc:p.expiry,rayon:p.department,notes:p.note||null,retire:false});if(error)throw error;if(!noReload)await loadProducts(true)}
async function addProductSmart(p){if(navigator.onLine){try{return await addProductRemote(p)}catch(e){}}const temp={...p,id:'local-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),done:false,doneAt:null};products.push(temp);saveLocal();queue({type:'insert',p});render();toast('Ajouté hors ligne — synchronisation à venir')}
async function deleteProductSmart(p){if(!confirm('Supprimer cette DLC saisie ?'))return;if(String(p.id).startsWith('local-')){products=products.filter(x=>x.id!==p.id)}else if(navigator.onLine){const {error}=await db.from('produits').delete().eq('id',p.id).eq('magasin_id',magasinId);if(error){queue({type:'delete',id:p.id});products=products.filter(x=>x.id!==p.id)}else await loadProducts(true)}else{queue({type:'delete',id:p.id});products=products.filter(x=>x.id!==p.id)}saveLocal();render();toast('DLC supprimée')}
function addAnotherDate(p){const cat=catalogueMeta(p.barcode),name=cat?.nom||p.name||p.barcode||'',dep=cat?.rayon||p.department||'Frais',note=p.note||cat?.notes||'';$('name').value=name;$('barcode').value=p.barcode||'';refreshDepartmentSelect();const opts=[...$('department').options].map(o=>o.value);if(opts.includes(dep))$('department').value=dep;$('note').value=note;resetDlcRows(iso(today()),1);show('addView');toast('Référence reprise — ajoutez vos DLC')}

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
    const url='https://world.openfoodfacts.org/api/v2/product/'+encodeURIComponent(code)+'.json?fields=code,product_name,product_name_fr,brands,quantity,categories,categories_tags,image_front_small_url,image_front_url,image_url';
    const r=await fetch(url,{headers:{'Accept':'application/json'}});
    if(!r.ok)return null;
    const j=await r.json();
    if(j.status!==1||!j.product)return null;
    const p=j.product;
    const name=(p.product_name_fr||p.product_name||'').trim();
    if(!name)return null;
    return {nom:name,marque:(p.brands||'').trim(),rayon:guessDepartment(p),notes:(p.quantity||'').trim(),photo_url:(p.image_front_small_url||p.image_front_url||p.image_url||'').trim(),source:'openfoodfacts'};
  }catch(e){console.warn('Open Food Facts:',e);return null}
}
async function rememberCatalogueProduct(p){
  if(!db||!magasinId||!p.barcode||!p.name)return;
  const existing=catalogue.find(x=>x.code_barres===p.barcode);const payload={magasin_id:+magasinId,code_barres:p.barcode,nom:p.name,marque:'',rayon:p.department||null,notes:p.note||null,photo_url:existing?.photo_url||p.photo_url||null,source:'magasin',updated_at:new Date().toISOString()};
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
    if(off.photo_url){await saveCataloguePhoto(code,off.photo_url,off);}
    toast('Produit reconnu automatiquement');
  }else{
    $('name').value='';
    toast('Produit inconnu : entrez son nom une fois');
  }
  show('addView');
}

function saveCatalogueLocal(){localStorage.setItem(KCAT,JSON.stringify(catalogue))}
function photoForBarcode(code){return catalogue.find(x=>x.code_barres===code)?.photo_url||''}
function productPhotoHTML(code,name=''){const url=photoForBarcode(code);return url?`<img class="productPhoto" src="${esc(url)}" alt="${esc(name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="photoFallback" style="display:none">▥</span>`:`<span class="photoFallback">▥</span>`}
async function saveCataloguePhoto(code,url,off=null){
  if(!db||!magasinId||!code||!url)return;
  const row=catalogue.find(x=>x.code_barres===code);
  if(row){row.photo_url=url;saveCatalogueLocal();renderCatalogue();render()}
  if(isAdmin()){
    const payload={photo_url:url,updated_at:new Date().toISOString()};
    if(!row&&off)Object.assign(payload,{magasin_id:+magasinId,code_barres:code,nom:off.nom||code,marque:off.marque||'',rayon:off.rayon||null,notes:off.notes||null,source:'openfoodfacts'});
    try{if(row)await db.from('catalogue_produits').update(payload).eq('id',row.id).eq('magasin_id',magasinId);else if(off)await db.from('catalogue_produits').upsert(payload,{onConflict:'magasin_id,code_barres'})}catch(e){console.warn('Photo catalogue:',e)}
  }
}
async function enrichMissingPhotos(limit=60){
  if(!navigator.onLine||!isAdmin())return;
  const missing=catalogue.filter(x=>!x.photo_url&&x.code_barres).slice(0,limit);
  for(const row of missing){const off=await lookupOpenFoodFacts(row.code_barres);if(off?.photo_url)await saveCataloguePhoto(row.code_barres,off.photo_url,off)}
}
function resetDlcRows(date=iso(today()),qtyValue=1){
  const box=$('dlcRows');if(!box)return;box.innerHTML=dlcRowHTML(date,qtyValue,false);refreshDlcRemoveButtons();
}
function dlcRowHTML(date=iso(today()),qtyValue=1,removable=true){return `<div class="dlcEntry"><label>Date<input class="dlcDate" type="date" required value="${esc(date)}"></label><label>Quantité<div class="quantity compactQty"><button type="button" class="qtyMinus">−</button><input class="dlcQty" type="number" min="1" value="${Math.max(1,+qtyValue||1)}"><button type="button" class="qtyPlus">+</button></div></label><button type="button" class="removeDlcRow ${removable?'':'hidden'}" aria-label="Supprimer cette date">×</button></div>`}
function refreshDlcRemoveButtons(){const rows=$$('.dlcEntry');rows.forEach(r=>r.querySelector('.removeDlcRow')?.classList.toggle('hidden',rows.length===1))}
function groupedProducts(list){
  const m=new Map();for(const p of list){const k=p.barcode||`${p.name}|${p.department}`,cat=catalogueMeta(p.barcode);if(!m.has(k))m.set(k,{key:k,name:cat?.nom||p.name||p.barcode||'Produit',barcode:p.barcode,department:cat?.rayon||p.department||'Frais',note:p.note||cat?.notes||'',items:[]});m.get(k).items.push(p)}return [...m.values()]
}

function productGroupHTML(g){
  const items=[...g.items].sort((a,b)=>String(a.expiry).localeCompare(String(b.expiry)));
  const total=qty(items.filter(x=>!x.done));
  return `<div class="productGroup"><div class="productGroupTop"><div class="groupPhoto">${productPhotoHTML(g.barcode,g.name)}</div><div class="pinfo"><b>${esc(g.name)}</b><small>${g.barcode?'EAN '+esc(g.barcode)+' · ':''}${esc(g.department)}</small></div><span class="groupQty">${total?total+' u.':''}</span></div><div class="dlcMiniList">${items.map(p=>{let[s,c]=status(p);return `<div class="dlcMiniRow"><div><span class="badge ${c}">${s}</span><b>${fmt(p.expiry)}</b><small>Quantité : ${+p.quantity||1}</small></div><button data-delete-product="${p.id}">Supprimer</button></div>`}).join('')}</div><button class="addGroupDlc" data-add-date="${items[0]?.id||''}">＋ Ajouter des DLC</button></div>`
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
  const adminViews=['storeSettingsView','employeesView','catalogueView','catalogueEditView','departmentsView','backupView'];
  if(adminViews.includes(id)&&!isAdmin()){toast('Réservé à l’administrateur');id='settingsView'}
  stopScan();$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===id));
  if(id==='scanView')setTimeout(startScan,200);
  if(id==='storeSettingsView'){$('storePageInput').value='Proxi - Monéteau';$('storeCodeInput').value=localStorage.getItem(KC)||'582941'}
  if(id==='employeesView'){$('codeDisplayPage').textContent=localStorage.getItem(KC)||'582941';loadEmployees()}
  if(id==='departmentsView')loadDepartmentsRemote().then(renderDepartments);if(id==='notificationsView')loadNotifications();if(id==='catalogueView')loadCatalogue();applyRoleUI();render();
}
function productHTML(p,check=false){let[s,c]=status(p);return `<div class="product"><div class="picon productThumb">${productPhotoHTML(p.barcode,p.name)}</div><div class="pinfo"><b>${esc(p.name)}</b><span class="badge ${c}">${s}</span><small>${fmt(p.expiry)} · ${esc(p.department)}</small><div class="productActions"><button data-add-date="${p.id}">＋ DLC</button><button data-delete-product="${p.id}">Supprimer</button></div></div><span class="qtyText">${p.quantity>1?'x'+p.quantity:''}</span>${check?`<button class="check ${p.done?'done':''}" data-done="${p.id}">${p.done?'✓':''}</button>`:''}</div>`}
function render(){
  let t=today();if($('currentDate'))$('currentDate').textContent=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(t);
  if($('todayCount'))$('todayCount').textContent=qty(arr('today'));if($('tomorrowCount'))$('tomorrowCount').textContent=qty(arr('tomorrow'));if($('weekCount'))$('weekCount').textContent=qty(arr('week'));
  let names=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];if($('upcoming'))$('upcoming').innerHTML=[0,1,2,3,4].map(n=>{let d=add(t,n),c=qty(products.filter(p=>!p.done&&p.expiry===iso(d)));return `<div class="day ${n===0?'today':''}"><b>${names[d.getDay()]}</b><strong>${d.getDate()}</strong><span>${c||'0'}</span></div>`}).join('');
  if($('heroDateText'))$('heroDateText').textContent=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(t);
  if($('heroStoreName'))$('heroStoreName').textContent='Proxi - Monéteau';
  const activeProducts=products.filter(p=>!p.done), refCount=new Set(activeProducts.map(p=>p.barcode||p.name)).size;
  if($('homeProductStat'))$('homeProductStat').textContent=refCount;
  if($('homeRayonStat'))$('homeRayonStat').textContent=getDepartments().length;
  if($('homeTeamStat'))$('homeTeamStat').textContent=employees.filter(x=>x.actif!==false).length||1;
  if($('homeDlcStat'))$('homeDlcStat').textContent=qty(arr('week'));
  if($('heroStatusText')){const n=qty(arr('today'));$('heroStatusText').textContent=n?n+' produit'+(n>1?'s':'')+' à contrôler aujourd’hui':'Tout est à jour';}
  if($('homeRecent')){const recent=[...activeProducts].slice(-4).reverse();$('homeRecent').innerHTML=recent.length?recent.map(p=>`<button data-add-date="${p.id}"><span class="recentThumb">${productPhotoHTML(p.barcode,p.name)}</span><span><b>Produit suivi</b><small>${p.barcode?esc(p.barcode)+' · ':''}${esc(p.name)}</small></span><em>${fmt(p.expiry)}</em></button>`).join(''):'<div class="homeEmpty">Aucun produit suivi pour le moment.</div>'; }
  let q=($('search')?.value||'').toLowerCase();let ps=products.filter(p=>p.name.toLowerCase().includes(q)||(p.barcode||'').includes(q));if(filter!=='all')ps=ps.filter(p=>arr(filter).some(x=>x.id===p.id));if($('productList')){const gs=groupedProducts(ps);$('productList').innerHTML=gs.length?gs.map(productGroupHTML).join(''):'<div class="card">Aucun produit.</div>';}
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
  catalogue=data||[];saveCatalogueLocal();renderCatalogue();render();setTimeout(()=>enrichMissingPhotos(),300);
}
function renderCatalogue(){
  if(!$('catalogueList'))return;
  const q=($('catalogueSearch')?.value||'').trim().toLowerCase();
  const rows=catalogue.filter(x=>(x.nom||'').toLowerCase().includes(q)||(x.code_barres||'').includes(q));
  $('catalogueCount').textContent=catalogue.length;
  $('catalogueList').innerHTML=rows.length?rows.map(x=>`<button class="catalogueItem" data-cat-id="${x.id}"><span class="eanIcon cataloguePhotoBox">${x.photo_url?`<img src="${esc(x.photo_url)}" alt="${esc(x.nom)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="photoFallback" style="display:none">▥</span>`:`<span class="photoFallback">▥</span>`}</span><span class="catInfo"><b>${esc(x.nom)}</b><small>EAN ${esc(x.code_barres)}${x.rayon?' · '+esc(x.rayon):''}</small></span><span class="chev">›</span></button>`).join(''):'<div class="card emptyCatalogue"><strong>Aucune référence trouvée</strong><span>Ajoutez un EAN pour qu’il soit reconnu au scan.</span></div>';
}
function fillCatalogueDepartments(selected=''){
  const sel=$('catalogueDepartment');if(!sel)return;const deps=getDepartments();sel.innerHTML='<option value="">Non renseigné</option>'+deps.map(x=>`<option>${esc(x)}</option>`).join('');if(selected)sel.value=selected;
}
function openCatalogueEditor(row=null){
  $('catalogueId').value=row?.id||'';$('catalogueBarcode').value=row?.code_barres||'';$('catalogueName').value=row?.nom||'';$('catalogueNotes').value=row?.notes||'';$('cataloguePhotoUrl').value=row?.photo_url||'';const preview=$('cataloguePhotoPreview');if(row?.photo_url){preview.src=row.photo_url;preview.classList.remove('hidden')}else{preview.removeAttribute('src');preview.classList.add('hidden')}fillCatalogueDepartments(row?.rayon||'');$('catalogueEditTitle').textContent=row?'Modifier la référence':'Ajouter une référence';$('deleteCatalogueBtn').classList.toggle('hidden',!row);show('catalogueEditView');
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
$$('[data-view]').forEach(b=>b.onclick=()=>show(b.dataset.view));$$('[data-daily]').forEach(b=>b.onclick=()=>openDaily(b.dataset.daily));$('addBtn').onclick=()=>{resetDlcRows();show('addView')};$('scanTab').onclick=()=>show('scanView');
$('productForm').onsubmit=async e=>{e.preventDefault();if(!magasinId)return toast('Reconnectez le magasin');const base={name:$('name').value.trim(),department:$('department').value,note:$('note').value.trim(),barcode:$('barcode').value};const rows=$$('.dlcEntry').map(r=>({expiry:r.querySelector('.dlcDate').value,quantity:+r.querySelector('.dlcQty').value||1})).filter(x=>x.expiry);if(!rows.length)return toast('Ajoutez au moins une DLC');try{for(const row of rows)await addProductSmart({...base,...row});if(navigator.onLine)await rememberCatalogueProduct(base);e.target.reset();resetDlcRows();toast(rows.length+' DLC enregistrée'+(rows.length>1?'s':''));show('homeView')}catch(err){console.error(err);toast('Impossible d’ajouter les DLC')}};
$('search').oninput=render;$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render()});
document.addEventListener('click',async e=>{let a=e.target.closest('[data-add-date]');if(a){let p=products.find(x=>String(x.id)===String(a.dataset.addDate));if(p)addAnotherDate(p);return}let d=e.target.closest('[data-delete-product]');if(d){let p=products.find(x=>String(x.id)===String(d.dataset.deleteProduct));if(p)await deleteProductSmart(p);return}});

$('addDlcRow').onclick=()=>{$('dlcRows').insertAdjacentHTML('beforeend',dlcRowHTML(iso(today()),1,true));refreshDlcRemoveButtons()};
document.addEventListener('click',e=>{const plus=e.target.closest('.qtyPlus'),minus=e.target.closest('.qtyMinus'),remove=e.target.closest('.removeDlcRow');if(plus){const i=plus.parentElement.querySelector('.dlcQty');i.value=(+i.value||1)+1;return}if(minus){const i=minus.parentElement.querySelector('.dlcQty');i.value=Math.max(1,(+i.value||1)-1);return}if(remove){remove.closest('.dlcEntry').remove();refreshDlcRemoveButtons()}});

document.addEventListener('click',async e=>{let b=e.target.closest('[data-done]');if(!b)return;let p=products.find(x=>x.id==b.dataset.done);if(!p)return;try{await setDoneRemote(p.id,!p.done);openDaily(dailyMode);toast(p.done?'Produit remis en attente':'Produit retiré')}catch(err){console.error(err);toast('Modification impossible')}});
$('doneAll').onclick=async()=>{let a=arr(dailyMode);try{for(const p of a)await setDoneRemote(p.id,true);toast('Tout est retiré');openDaily(dailyMode)}catch(e){toast('Une erreur est survenue')}};
$('manualBarcodeBtn').onclick=()=>{let c=prompt('Numéro sous le code-barres :');if(c){stopScan();identifyBarcode(c.trim())}};
$('teamBtn').onclick=()=>show('employeesView');$('menuBtn').onclick=()=>show('settingsView');
$('exportBtn').onclick=()=>{let blob=new Blob([JSON.stringify({store:'Proxi - Monéteau',products},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='frais-proxi-v5.5.1.json';a.click()};
function getDepartments(){return departments.length?departments:['Crèmerie','Charcuterie','Frais','Traiteur','Épicerie','Boucherie','Poissonnerie']}
function refreshDepartmentSelect(){let a=getDepartments(),sel=$('department'),cur=sel.value;sel.innerHTML=a.map(x=>`<option>${esc(x)}</option>`).join('');if(a.includes(cur))sel.value=cur}
async function renderDepartments(){
  if(!db||!magasinId)return;
  const {data,error}=await db.from('rayons').select('*').eq('magasin_id',magasinId).order('position',{ascending:true}).order('nom',{ascending:true});
  if(error){toast('Rayons indisponibles');return}
  const rows=data||[];
  $('departmentList').innerHTML=rows.map(x=>`<div class="departmentRow"><span>${esc(x.nom)}</span><button data-del-dep="${x.id}" aria-label="Supprimer">×</button></div>`).join('');
}
function loadNotifications(){let n={today:true,tomorrow:true,days:1};try{n={...n,...JSON.parse(localStorage.getItem(KN)||'{}')}}catch(e){}$('notifToday').checked=n.today;$('notifTomorrow').checked=n.tomorrow;if($('notifDays'))$('notifDays').value=String(n.days||1)}
$('saveStorePage').onclick=()=>{localStorage.setItem(KS,'Proxi - Monéteau');let code=$('storeCodeInput').value.trim();if(code)localStorage.setItem(KC,code);render();toast('Informations enregistrées')};
$('addDepartment').onclick=async()=>{if(!isAdmin())return toast('Réservé à l’administrateur');let v=$('newDepartment').value.trim();if(!v)return;const {error}=await db.from('rayons').insert({magasin_id:+magasinId,nom:v,position:getDepartments().length+1,actif:true});if(error){console.error(error);return toast('Impossible d’ajouter ce rayon')}$('newDepartment').value='';await loadDepartmentsRemote();await renderDepartments();toast('Rayon ajouté')};
document.addEventListener('click',async e=>{let b=e.target.closest('[data-del-dep]');if(!b)return;if(!isAdmin())return toast('Réservé à l’administrateur');if(!confirm('Supprimer ce rayon ?'))return;const {error}=await db.from('rayons').delete().eq('id',b.dataset.delDep).eq('magasin_id',magasinId);if(error)return toast('Suppression impossible');await loadDepartmentsRemote();await renderDepartments();toast('Rayon supprimé')});
$('saveNotifications').onclick=()=>{localStorage.setItem(KN,JSON.stringify({today:$('notifToday').checked,tomorrow:$('notifTomorrow').checked,days:+($('notifDays')?.value||1)}));toast('Notifications enregistrées')};
$('importFile').onchange=e=>{toast('Import local désactivé avec la synchronisation en ligne')};

$('refreshEmployees').onclick=()=>loadEmployees();
document.addEventListener('click',async e=>{
  const roleBtn=e.target.closest('[data-employee-role]');
  if(roleBtn){
    if(!isAdmin())return toast('Réservé à l’administrateur');
    const uid=roleBtn.dataset.employeeRole, next=roleBtn.dataset.currentRole==='admin'?'employe':'admin';
    const {error}=await db.from('acces_magasin').update({role:next,updated_at:new Date().toISOString()}).eq('magasin_id',magasinId).eq('user_id',uid);
    if(error)return toast('Modification impossible');await loadEmployees();await loadMyAccess();toast('Rôle modifié');return;
  }
  const activeBtn=e.target.closest('[data-employee-active]');
  if(activeBtn){
    if(!isAdmin())return toast('Réservé à l’administrateur');
    const uid=activeBtn.dataset.employeeActive, next=activeBtn.dataset.currentActive!=='1';
    const {data:{session}}=await db.auth.getSession();
    if(session?.user?.id===uid&&!next)return toast('Vous ne pouvez pas désactiver votre propre accès');
    const {error}=await db.from('acces_magasin').update({actif:next,updated_at:new Date().toISOString()}).eq('magasin_id',magasinId).eq('user_id',uid);
    if(error)return toast('Modification impossible');await loadEmployees();toast(next?'Accès activé':'Accès désactivé');
  }
});
$('catalogueSearch').oninput=renderCatalogue;
$('refreshCatalogue').onclick=()=>loadCatalogue();
$('newCatalogueBtn').onclick=()=>openCatalogueEditor();
document.addEventListener('click',e=>{const b=e.target.closest('[data-cat-id]');if(!b)return;const row=catalogue.find(x=>String(x.id)===String(b.dataset.catId));if(row)openProductDetail(row)});
$('catalogueForm').onsubmit=async e=>{e.preventDefault();if(!magasinId)return toast('Reconnectez le magasin');const id=$('catalogueId').value;const payload={magasin_id:+magasinId,code_barres:$('catalogueBarcode').value.trim(),nom:$('catalogueName').value.trim(),rayon:$('catalogueDepartment').value||null,notes:$('catalogueNotes').value.trim()||null,photo_url:$('cataloguePhotoUrl').value.trim()||null,source:'magasin',updated_at:new Date().toISOString()};let res=id?await db.from('catalogue_produits').update(payload).eq('id',id).eq('magasin_id',magasinId):await db.from('catalogue_produits').upsert(payload,{onConflict:'magasin_id,code_barres'});if(res.error){console.error(res.error);return toast('Impossible d’enregistrer')}toast('Référence enregistrée');await loadCatalogue();show('catalogueView')};
$('deleteCatalogueBtn').onclick=async()=>{const id=$('catalogueId').value;if(!id)return;if(!confirm('Supprimer cette référence du catalogue ?'))return;const {error}=await db.from('catalogue_produits').delete().eq('id',id).eq('magasin_id',magasinId);if(error)return toast('Suppression impossible');toast('Référence supprimée');await loadCatalogue();show('catalogueView')};

$('findCataloguePhotoBtn').onclick=async()=>{const code=$('catalogueBarcode').value.trim();if(!code)return toast('Entrez d’abord le code EAN');$('findCataloguePhotoBtn').disabled=true;toast('Recherche de la photo…');const off=await lookupOpenFoodFacts(code);$('findCataloguePhotoBtn').disabled=false;if(!off?.photo_url)return toast('Aucune photo trouvée pour cet EAN');$('cataloguePhotoUrl').value=off.photo_url;$('cataloguePhotoPreview').src=off.photo_url;$('cataloguePhotoPreview').classList.remove('hidden');if(!$('catalogueName').value.trim()&&off.nom)$('catalogueName').value=off.nom;toast('Photo trouvée')};
$('cataloguePhotoUrl').oninput=()=>{const u=$('cataloguePhotoUrl').value.trim(),img=$('cataloguePhotoPreview');if(u){img.src=u;img.classList.remove('hidden')}else img.classList.add('hidden')};


refreshDepartmentSelect();fillCatalogueDepartments();resetDlcRows();renderCatalogue();render();
window.addEventListener('focus',()=>{flushQueue();loadProducts(true)});window.addEventListener('online',()=>{toast('Connexion retrouvée — synchronisation…');flushQueue()});window.addEventListener('beforeunload',stopScan);

(async()=>{
  try{
    if(!db)return;
    const {data:{session}}=await db.auth.getSession();
    if(session && magasinId){await loadMyAccess();if(currentAccess?.actif===false){localStorage.removeItem(KM);magasinId=null;return}await loadDepartmentsRemote();await loadCatalogue();$('welcome').classList.add('hidden');$('login').classList.add('hidden');$('app').classList.remove('hidden');await loadProducts(true);startSyncTimer();applyRoleUI();render()}
  }catch(e){console.error(e)}
})();

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=55').catch(console.warn))}

// V5.6 — actions dynamiques de l'accueil
document.addEventListener('click',e=>{const b=e.target.closest('#homeRecent [data-add-date]');if(!b)return;const p=products.find(x=>String(x.id)===String(b.dataset.addDate));if(p)addAnotherDate(p)});
// Planning DLC - liste complète jour par jour
function renderPlanningDlc(){
  const box = document.getElementById('planningList');
  if(!box) return;

  const liste = (products || [])
    .filter(p => p && p.dlc && !p.retire)
    .sort((a,b) => String(a.dlc).localeCompare(String(b.dlc)));

  if(!liste.length){
    box.innerHTML = '<div class="card"><p>Aucune DLC enregistrée.</p></div>';
    return;
  }

  const groupes = {};
  liste.forEach(p => {
    if(!groupes[p.dlc]) groupes[p.dlc] = [];
    groupes[p.dlc].push(p);
  });

  const esc = v => String(v ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;');

  box.innerHTML = Object.keys(groupes).map(date => {
    const d = new Date(date + 'T12:00:00');
    const titre = new Intl.DateTimeFormat('fr-FR',{
      weekday:'long',
      day:'numeric',
      month:'long',
      year:'numeric'
    }).format(d);

    const lignes = groupes[date].map(p => `
      <div class="planningProduct">
        <div>
          <b>${esc(p.nom || 'Produit')}</b>
          <small>${esc(p.rayon || 'Sans rayon')}</small>
        </div>
        <strong>${Number(p.quantite || 1)} unité${Number(p.quantite || 1) > 1 ? 's' : ''}</strong>
      </div>
    `).join('');

    return `
      <section class="planningDay">
        <div class="planningDayHead">
          <h3>${titre}</h3>
          <span>${groupes[date].length} produit${groupes[date].length > 1 ? 's' : ''}</span>
        </div>
        ${lignes}
      </section>
    `;
  }).join('');
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-view="planningView"]');
  if(b) setTimeout(renderPlanningDlc, 50);
});
// Correction Planning DLC
function renderPlanningDlc(){
  const box = document.getElementById('planningList');
  if(!box) return;

  const liste = (products || [])
    .filter(p => p && p.expiry && !p.done)
    .sort((a,b) => String(a.expiry).localeCompare(String(b.expiry)));

  if(!liste.length){
    box.innerHTML = '<div class="card">Aucune DLC enregistrée.</div>';
    return;
  }

  const groupes = {};
  liste.forEach(p => {
    if(!groupes[p.expiry]) groupes[p.expiry] = [];
    groupes[p.expiry].push(p);
  });

  box.innerHTML = Object.keys(groupes).map(date => {
    const d = new Date(date + 'T12:00:00');

    const titre = new Intl.DateTimeFormat('fr-FR',{
      weekday:'long',
      day:'numeric',
      month:'long',
      year:'numeric'
    }).format(d);

    const lignes = groupes[date].map(p => `
      <div class="planningProduct">
        <div>
          <b>${esc(p.name || 'Produit')}</b>
          <small>${esc(p.department || 'Sans rayon')}</small>
        </div>
        <strong>${Number(p.quantity || 1)} u.</strong>
      </div>
    `).join('');

    return `
      <section class="planningDay">
        <div class="planningDayHead">
          <h3>${titre}</h3>
          <span>${qty(groupes[date])} produit(s)</span>
        </div>
        ${lignes}
      </section>
    `;
  }).join('');
}
// Planning DLC avec choix du jour
function planningDateIso(offset=0){
  const d=new Date();
  d.setHours(12,0,0,0);
  d.setDate(d.getDate()+offset);
  return d.getFullYear()+'-'+
    String(d.getMonth()+1).padStart(2,'0')+'-'+
    String(d.getDate()).padStart(2,'0');
}

function renderPlanningDlc(dateChoisie){
  const box=document.getElementById('planningList');
  if(!box) return;

  const date=dateChoisie || planningDateIso(0);
  const picker=document.getElementById('planningDatePicker');
  if(picker) picker.value=date;

  const liste=(products || []).filter(p =>
    p && p.expiry===date && !p.done
  );

  const d=new Date(date+'T12:00:00');
  const titre=new Intl.DateTimeFormat('fr-FR',{
    weekday:'long',
    day:'numeric',
    month:'long',
    year:'numeric'
  }).format(d);

  if(!liste.length){
    box.innerHTML=`
      <section class="planningDay">
        <div class="planningDayHead"><h3>${titre}</h3></div>
        <div class="card">✅ Aucun produit à retirer ce jour-là.</div>
      </section>`;
    return;
  }

  const lignes=liste.map(p=>`
    <div class="planningProduct">
      <div>
        <b>${esc(p.name || 'Produit')}</b>
        <small>${esc(p.department || 'Sans rayon')}</small>
      </div>
      <strong>${Number(p.quantity || 1)} u.</strong>
    <button type="button" class="planningDoneBtn" data-done="${p.id}">✓ Retiré</button>
    </div>
  `).join('');

  box.innerHTML=`
    <section class="planningDay">
      <div class="planningDayHead">
        <h3>${titre}</h3>
        <span>${liste.length} produit(s)</span>
      </div>
      ${lignes}
    </section>`;
}

document.addEventListener('click',e=>{
  const jour=e.target.closest('[data-planning-offset]');
  if(jour){
    renderPlanningDlc(
      planningDateIso(Number(jour.dataset.planningOffset || 0))
    );
  }

  const planning=e.target.closest('[data-view="planningView"]');
  if(planning){
    setTimeout(()=>renderPlanningDlc(planningDateIso(0)),50);
  }
});

document.addEventListener('change',e=>{
  if(e.target.id==='planningDatePicker'){
    renderPlanningDlc(e.target.value);
  }
});
let currentProductDetail = null;
let catalogueScrollY = 0;
function openProductDetail(row){
  if(!row) return;
catalogueScrollY = window.scrollY;
  currentProductDetail = row;

  $('productDetailName').textContent = row.nom || 'Produit';
  $('productDetailBarcode').textContent =
    'EAN ' + (row.code_barres || 'Non renseigné');
const rayonSelect = $('productDetailRayonSelect');

if(rayonSelect){
  rayonSelect.innerHTML = departments
    .map(r => `<option value="${esc(r)}">${esc(r)}</option>`)
    .join('');

  const rayonActuel = row.rayon || autoCatalogueRayon(row.nom || '');

  if(departments.includes(rayonActuel)){
    rayonSelect.value = rayonActuel;
  }
}
  const img = $('productDetailPhoto');

  if(row.photo_url){
    img.src = row.photo_url;
    img.classList.remove('hidden');
  }else{
    img.removeAttribute('src');
    img.classList.add('hidden');
  }

  const dlcs = products
    .filter(p => String(p.barcode || '') === String(row.code_barres || ''))
    .sort((a,b) => String(a.expiry).localeCompare(String(b.expiry)));

  $('productDetailDlcList').innerHTML = dlcs.length
    ? dlcs.map(p => {
        const [label, color] = status(p);

        return `
          <div class="productDetailDlcRow">
            <div>
              <span class="badge ${color}">${label}</span>
              <b>${fmt(p.expiry)}</b>
              <small>Quantité : ${p.quantity || 1}</small>
            </div>

            <button type="button" data-delete-product="${p.id}">
              Supprimer
            </button>
          </div>
        `;
      }).join('')
    : '<div class="card">Aucune DLC enregistrée pour cette référence.</div>';

  show('productDetailView');
}

$('productDetailAddDlcBtn').onclick = () => {
  if(!currentProductDetail) return;

  const row = currentProductDetail;
  const existing = products.find(
    p => String(p.barcode || '') === String(row.code_barres || '')
  );

  if(existing){
    addAnotherDate(existing);
    return;
  }

  $('name').value = row.nom || '';
  $('barcode').value = row.code_barres || '';

  refreshDepartmentSelect();

  const rayonAuto = autoCatalogueRayon(row.nom || '');

const options = [...$('department').options].map(o => o.value);

if(options.includes(rayonAuto)){
  $('department').value = rayonAuto;
}else if(row.rayon && options.includes(row.rayon)){
  $('department').value = row.rayon;
}

  $('note').value = row.notes || '';
  resetDlcRows();
  show('addView');
};
function autoCatalogueRayon(name=''){
  const n = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  /* TRAITEUR : à tester avant poulet/viande */
  if(/baguette|sandwich|sdw|club|wrap|burger|pizza|quiche|croque|salade|slde|ricebox|box|paella|lasagne|lasagna|ravioli|tortellini|gnocchi|taboule|couscous|feuillete|crepe|galette|assortiment asiatique|plat prepare/.test(n)){
    return 'Traiteur';
  }

  /* CHARCUTERIE */
  if(/jambon|\bjb\b|jbon|jamb|saucisson|salami|chorizo|mortadelle|rosette|rillettes|lardon|bacon|charcut|pate|aoste|jambon cru|\bcru\b/.test(n)){
    return 'Charcuterie';
  }

  /* POISSONNERIE */
  if(/saumon|thon|truite|cabillaud|colin|crevette|poisson|surimi|coraya|crabe|moule|huitre|sardine|maquereau/.test(n)){
    return 'Poissonnerie';
  }

  /* BOUCHERIE / VIANDE */
  if(/boeuf|bœuf|steak|veau|agneau|porc|poulet|plet|dinde|\bdde\b|canard|volaille|escalope|viande|chipolata|merguez|hache|filet plet|filet poulet/.test(n)){
    return 'Boucherie';
  }

  /* CREMERIE */
  if(/yaourt|\byrt\b|yog|skyr|fromage|from\.|fr\.blc|fromage blanc|creme|\bcf\b|beurre|\bbeur\b|lait|faisselle|mozzarella|emmental|camembert|comte|chevre|mascarpone|apericube|aperivrais|mousse choco|dessert lacte/.test(n)){
    return 'Crèmerie';
  }

  /* FRAIS */
  if(/fruit|legume|tomate|carotte|pomme|cerise|fraise|melon|courgette|poivron|compote/.test(n)){
    return 'Frais';
  }
/* ===== RÈGLES SUPPLÉMENTAIRES ===== */

/* CRÈMERIE */
if(
  /activia|boursin|apericube|aperivrais|fromage|fromage blanc|yaourt|yrt|yog|skyr|beurre|creme|lait/.test(n)
){
  return 'Crèmerie';
}

/* CHARCUTERIE */
if(
  /lard|andouillette|boudin|jambon|jbon|jb cru|saucisson|salami|chorizo|mortadelle|rosette|bacon|lardon/.test(n)
){
  return 'Charcuterie';
}

/* TRAITEUR */
if(
  /blini|houmous|tarama|accras|baguette|sandwich|sdw|club|wrap|burger|pizza|quiche|lasagne|paella|pasta|pate|sushi/.test(n)
){
  return 'Traiteur';
}

/* POISSONNERIE */
if(
  /morue|surimi|saumon|thon|truite|cabillaud|colin|crevette|poisson/.test(n)
){
  return 'Poissonnerie';
}

/* BOUCHERIE */
if(
  /poulet|plet|dinde|dde|boeuf|bœuf|steak|veau|agneau|porc|escalope|volaille/.test(n)
){
  return 'Boucherie';
}
  return 'Autres';
}
/* ===== CATALOGUE TRIÉ PAR RAYON ===== */

function renderCatalogue(){
  const list = $('catalogueList');
  if(!list) return;

  const q = ($('catalogueSearch')?.value || '').trim().toLowerCase();

  const rows = catalogue.filter(x =>
    (x.nom || '').toLowerCase().includes(q) ||
    String(x.code_barres || '').includes(q)
  );

  $('catalogueCount').textContent = catalogue.length;

  if(!rows.length){
    list.innerHTML = '<p class="muted">Aucun produit trouvé.</p>';
    return;
  }

  const groups = {};

  rows.forEach(x => {
    const rayon = (x.rayon || '').trim() || autoCatalogueRayon(x.nom || '');

    if(!groups[rayon]){
      groups[rayon] = [];
    }

    groups[rayon].push(x);
  });

  const rayonOrder = [...departments, 'Non renseigné'];

  const rayons = Object.keys(groups).sort((a,b) => {
    const ia = rayonOrder.indexOf(a);
    const ib = rayonOrder.indexOf(b);

    if(ia !== -1 && ib !== -1) return ia - ib;
    if(ia !== -1) return -1;
    if(ib !== -1) return 1;

    return a.localeCompare(b, 'fr');
  });

  list.innerHTML = rayons.map(rayon => {

    const items = groups[rayon].sort((a,b) =>
      (a.nom || '').localeCompare(b.nom || '', 'fr')
    );

    return `
      <section class="catalogueRayonGroup">

        <h3 class="catalogueRayonTitle">
          ${esc(rayon)}
          <span>${items.length}</span>
        </h3>

        <div class="catalogueRayonItems">

          ${items.map(x => `
            <button class="catalogueItem" data-cat-id="${x.id}">

              ${productPhotoHTML(x.code_barres, x.nom || '')}

              <span class="catalogueItemText">
                <b>${esc(x.nom || 'Produit')}</b>
                <small>EAN ${esc(x.code_barres || '')}</small>
              </span>

            </button>
          `).join('')}

        </div>
      </section>
    `;

  }).join('');
}  
const productDetailBackBtn =
  document.querySelector('#productDetailView [data-view="catalogueView"]');

if(productDetailBackBtn){
  productDetailBackBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();

    show('catalogueView');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, catalogueScrollY);
      });
    });
  });
}
const saveRayonBtn = $('productDetailSaveRayonBtn');

if(saveRayonBtn){
  saveRayonBtn.addEventListener('click', async () => {
    if(!currentProductDetail) return;

    const select = $('productDetailRayonSelect');
    const nouveauRayon = select?.value;

    if(!nouveauRayon) return;

    saveRayonBtn.disabled = true;
    saveRayonBtn.textContent = 'Enregistrement...';

    const { error } = await db
      .from('catalogue_produits')
      .update({ rayon: nouveauRayon })
      .eq('id', currentProductDetail.id);

    if(error){
      alert('Erreur pendant l’enregistrement du rayon.');
      saveRayonBtn.disabled = false;
      saveRayonBtn.textContent = 'Enregistrer le rayon';
      return;
    }

    currentProductDetail.rayon = nouveauRayon;

    const produitCatalogue = catalogue.find(
      x => String(x.id) === String(currentProductDetail.id)
    );

    if(produitCatalogue){
      produitCatalogue.rayon = nouveauRayon;
    }

    saveRayonBtn.disabled = false;
    saveRayonBtn.textContent = 'Rayon enregistré ✓';

    renderCatalogue();

    setTimeout(() => {
      saveRayonBtn.textContent = 'Enregistrer le rayon';
    }, 1500);
  });
}
/* ===== LISTES RETRO / CASSE ===== */

function regleCasseProduit(p){
  const catalogueRow = catalogue.find(
    x => String(x.code_barres || '') === String(p.barcode || '')
  );

  const rayon = String(
    catalogueRow?.rayon || p.department || ''
  ).toLowerCase()
   .normalize('NFD')
   .replace(/[\u0300-\u036f]/g, '');

  const nom = String(p.name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  /* CREMERIE / YAOURTS : casse J-6, rétro J-7 */
  if(
    rayon.includes('cremerie') ||
    /yaourt|\byrt\b|yogourt|yogurt|skyr|fromage blanc/.test(nom)
  ){
    return 6;
  }

  /* PAIN DE MIE / BRIOCHE / CHARCUTERIE : casse J-5, rétro J-6 */
  if(
    rayon.includes('charcuterie') ||
    /pain de mie|pdm|brioche/.test(nom)
  ){
    return 5;
  }

  /* SNACK / SALADES : casse J-2, rétro J-3 */
  if(
    /sandwich|sdw|club|wrap|burger|baguette|snack|salade|slde/.test(nom)
  ){
    return 2;
  }

  /* BOUCHERIE / VOLAILLE / SAURISSERIE : casse J-2, rétro J-3 */
  if(
    rayon.includes('boucherie') ||
    rayon.includes('volaille') ||
    rayon.includes('saurisserie') ||
    /poulet|plet|dinde|dde|boeuf|bœuf|veau|agneau|steak|escalope|volaille|saurisserie/.test(nom)
  ){
    return 2;
  }

  return null;
}

function joursAvantDlc(dateIso){
  if(!dateIso) return null;

  const aujourdHui = new Date();
  aujourdHui.setHours(0,0,0,0);

  const dlc = new Date(dateIso + 'T00:00:00');
  dlc.setHours(0,0,0,0);

  return Math.round((dlc - aujourdHui) / 86400000);
}

function renderRetroCasse(){
  const retroList = $('retroList');
  const casseList = $('casseList');

  if(!retroList || !casseList) return;

  const retro = [];
  const casse = [];

  products
    .filter(p => !p.done && p.expiry)
    .forEach(p => {
      const seuilCasse = regleCasseProduit(p);
      if(seuilCasse === null) return;

      const jours = joursAvantDlc(p.expiry);
      if(jours === null) return;

      if(jours === seuilCasse + 1){
        retro.push({...p, jours, seuilCasse});
      }else if(jours <= seuilCasse){
        casse.push({...p, jours, seuilCasse});
      }
    });

  retro.sort((a,b) => String(a.expiry).localeCompare(String(b.expiry)));
  casse.sort((a,b) => String(a.expiry).localeCompare(String(b.expiry)));

  retroList.innerHTML = retro.length
    ? retro.map(p => `
        <div class="card">
          <b>${esc(p.name || 'Produit')}</b>
          <p>DLC : ${fmt(p.expiry)} • Quantité : ${p.quantity || 1}</p>
          <small>Rétro J-${p.jours} → casse à J-${p.seuilCasse}</small>
        </div>
      `).join('')
    : '<div class="card">Aucun produit en rétro aujourd’hui.</div>';

  casseList.innerHTML = casse.length
    ? casse.map(p => `
        <div class="card">
          <b>${esc(p.name || 'Produit')}</b>
          <p>DLC : ${fmt(p.expiry)} • Quantité : ${p.quantity || 1}</p>
          <small>${p.jours < 0 ? 'DLC dépassée' : 'Casse J-' + p.jours}</small>
        </div>
      `).join('')
    : '<div class="card">Aucun produit en casse aujourd’hui.</div>';
}

document.addEventListener('click', e => {
  const btn = e.target.closest(
    '[data-view="retroView"], [data-view="casseView"]'
  );

  if(!btn) return;

  setTimeout(() => {
    renderRetroCasse();
  }, 0);
});
