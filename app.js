const SUPABASE_URL = 'https://sbimesnrwrxgkqkfhiaz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ASbg_BcoGRlcJLwsFX7utw_4hTFpBmp';
const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);

const KS='fpV4store', KC='fpV4code', KD='fpV4departments', KN='fpV4notifications', KM='fpV43magasinId', KP='fpV55products', KQ='fpV55queue', KCAT='fpV55catalogue', KDEVICE='fpV552deviceId';
const KEMP='fpEmployeConnecte';

let employeConnecte = JSON.parse(localStorage.getItem(KEMP) || 'null');
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
function arr(mode){
  let t=iso(today()), tm=iso(add(today(),1));
  let samedi=today().getDay()===6;
  let dimanche=iso(add(today(),1));

  return products.filter(p =>
    !p.done && (
      mode==='today'
        ? (samedi ? p.expiry<=dimanche : p.expiry<=t)
        : mode==='tomorrow'
          ? p.expiry===tm
          : mode==='week'
            ? inWeek(p)
            : true
    )
  );
}
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
function isAdmin(){
  if (employeConnecte) return employeConnecte.role === 'admin';
  return currentAccess?.role === 'admin' && currentAccess?.actif !== false;
}
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
  if(!db || !magasinId)return;
  const {data,error}=await db.rpc('lister_employes_app',{
    p_magasin_id:Number(magasinId)
  });
  if(error){console.error(error);toast('Impossible de charger les employés');return;}
  employees=data||[];
  renderEmployees();
}
function renderEmployees(){
  if(!$('employeeList'))return;

  $('employeeCount').textContent=String(employees.length);

  $('employeeList').innerHTML=employees.length
    ? employees.map(x=>{
        const role=x.role==='admin'?'Administrateur':'Employé';
        const active=x.actif!==false;

        return `<div class="employeeManageRow ${active?'':'disabled'}">
          <div class="employeeAvatar">👤</div>
          <div class="employeeManageInfo">
            <strong>${x.nom}</strong>
            <small>${active?'Accès actif':'Accès désactivé'}</small>
          </div>
          <span class="rolePill">${role}</span>
        </div>`;
      }).join('')
    : '<p class="muted">Aucun employé.</p>';
}
async function loadActivity(){
  const list = $('activityList');
  if(!list || !db || !magasinId) return;

  list.innerHTML = '<p class="muted">Chargement de l’historique…</p>';

  const {data,error} = await db.rpc('lire_historique_activite',{
    p_magasin_id:Number(magasinId)
  });

  if(error){
    console.error(error);
    list.innerHTML = '<p class="muted">Impossible de charger l’historique.</p>';
    return;
  }

  const rows = data || [];

  list.innerHTML = rows.length
    ? rows.map(x=>{
        const date = new Date(x.created_at).toLocaleString('fr-FR',{
          dateStyle:'short',
          timeStyle:'short'
        });

        return `<div class="employeeManageRow">
          <div class="employeeAvatar">👤</div>
          <div class="employeeManageInfo">
            <strong>${x.employe_nom}</strong>
            <small>${x.action}${x.details ? ' · '+x.details : ''}</small>
            <small>${date}</small>
          </div>
        </div>`;
      }).join('')
    : '<p class="muted">Aucune activité enregistrée.</p>';
}
async function loadDepartmentsRemote(){
  if(!db||!magasinId){refreshDepartmentSelect();return}
  const {data,error}=await db.from('rayons').select('*').eq('magasin_id',magasinId).eq('actif',true).order('position',{ascending:true}).order('nom',{ascending:true});
  if(!error&&data?.length)departments=data.map(x=>x.nom);
  refreshDepartmentSelect();fillCatalogueDepartments();
}
async function connecterEmploye(code) {
  if (!db || !magasinId) {
    throw new Error('Magasin non connecté');
  }

  const { data, error } = await db.rpc('connexion_employe', {
    p_magasin_id: Number(magasinId),
    p_code: String(code).trim()
  });

  if (error) throw error;

  if (!data || !data.length) {
    throw new Error('Code employé incorrect');
  }

  employeConnecte = {
    id: data[0].employe_id,
    nom: data[0].nom,
    role: data[0].role
  };

  localStorage.setItem(KEMP, JSON.stringify(employeConnecte));

  return employeConnecte;
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
  const adminViews=['storeSettingsView','employeesView','catalogueView','catalogueEditView','departmentsView','activityView','backupView'];
  if(adminViews.includes(id)&&!isAdmin()){toast('Réservé à l’administrateur');id='settingsView'}
  stopScan();$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===id));
  if(id==='scanView')setTimeout(startScan,200);
  if(id==='storeSettingsView'){$('storePageInput').value='Proxi - Monéteau';$('storeCodeInput').value=localStorage.getItem(KC)||'582941'}
 if(id==='employeesView'){loadEmployees();} 
  if(id==='activityView')loadActivity();
  if(id==='departmentsView')loadDepartmentsRemote().then(renderDepartments);if(id==='notificationsView')loadNotifications();if(id==='catalogueView')loadCatalogue();applyRoleUI();render();
}
function productHTML(p,check=false){
  let [s,c]=status(p);

  return `
    <div class="product">

      <div class="picon productThumb">
        ${productPhotoHTML(p.barcode,p.name)}
      </div>

      <div class="pinfo">

        <b>${esc(p.name)}</b>

        ${p.barcode
          ? `<small style="display:block;margin-top:3px;color:#6b7c89">
               EAN : ${esc(p.barcode)}
             </small>`
          : ''
        }

        <span class="badge ${c}">${s}</span>

        <small>
          ${fmt(p.expiry)} · ${esc(p.department)}
        </small>

        <div class="productActions">
          <button data-add-date="${p.id}">＋ DLC</button>
          <button data-delete-product="${p.id}">Supprimer</button>
        </div>

      </div>

      ${check
        ? `<button class="check ${p.done?'done':''}" data-done="${p.id}">
             ${p.done?'✓':''}
           </button>`
        : ''
      }

    </div>
  `;
}
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
function openDaily(m){
  dailyMode=m;
  let a=arr(m);
  let d=m==='today'?today():add(today(),1);

  $('dailyTitle').textContent=m==='today'
    ? (today().getDay()===6 ? "À retirer ce week-end" : "À retirer aujourd'hui")
    : "À surveiller demain";

  $('dailyCount').textContent=qty(a)+' produits';

  $('dailyDate').textContent='▣ '+new Intl.DateTimeFormat('fr-FR',{
    weekday:'long',
    day:'numeric',
    month:'long',
    year:'numeric'
  }).format(d);

  $('dailyList').innerHTML=a.length
    ? a.map(p=>productHTML(p,true)).join('')
    : '<div class="card">Aucun produit 🎉</div>';

  show('dailyView');
}
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
$('startBtn').onclick=()=>{
  $('welcome').classList.add('hidden');
  if(magasinId){
    $('employeeLogin').classList.remove('hidden');
  }else{
    $('login').classList.remove('hidden');
  }
};

$('loginBtn').onclick=async()=>{let c=$('shopCode').value.trim();if(c.length<4)return toast('Entrez le code magasin');$('loginBtn').disabled=true;try{await connectStore(c);$('login').classList.add('hidden');$('app').classList.remove('hidden');render();toast('Magasin connecté')}catch(e){console.error('Connexion Frais Proxi:',e);const msg=(e?.message||'Connexion impossible').trim();setSync(msg);if(/anonymous sign-ins are disabled/i.test(msg))toast('Connexion anonyme non encore active côté Supabase');else if(/invalid|code magasin|incorrect/i.test(msg))toast('Code magasin incorrect');else toast('Connexion impossible : '+msg.slice(0,80))}finally{$('loginBtn').disabled=false}};
$$('[data-view]').forEach(b=>b.onclick=()=>show(b.dataset.view));$$('[data-daily]').forEach(b=>b.onclick=()=>openDaily(b.dataset.daily));$('addBtn').onclick=()=>{resetDlcRows();show('addView')};$('scanTab').onclick=()=>show('scanView');
$('productForm').onsubmit=async e=>{e.preventDefault();if(!magasinId)return toast('Reconnectez le magasin');const base={name:$('name').value.trim(),department:$('department').value,note:$('note').value.trim(),barcode:$('barcode').value};const rows=$$('.dlcEntry').map(r=>({expiry:r.querySelector('.dlcDate').value,quantity:1})).filter(x=>x.expiry);if(!rows.length)return toast('Ajoutez au moins une DLC');try{for(const row of rows)await addProductSmart({...base,...row});if(navigator.onLine)await rememberCatalogueProduct(base);e.target.reset();resetDlcRows();toast(rows.length+' DLC enregistrée'+(rows.length>1?'s':''));show('homeView')}catch(err){console.error(err);toast('Impossible d’ajouter les DLC')}};
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
    if(session && magasinId){await loadMyAccess();if(currentAccess?.actif===false){localStorage.removeItem(KM);magasinId=null;return}await loadDepartmentsRemote();await loadCatalogue();await loadProducts(true);startSyncTimer();applyRoleUI();render();}
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
 /* ===== CLASSEMENT ÉTENDU ===== */

/* CRÈMERIE */
if(
  /chaussee aux moines|camembert|brie|comte|emmental|mozzarella|chevre|raclette|reblochon|munster|roquefort|feta|parmesan|gruyere|coulommiers|petit suisse|faisselle|dessert lacte|creme dessert|mousse choco|flan/.test(n)
){
  return 'Crèmerie';
}

/* CHARCUTERIE */
if(
  /cervela|cervelas|sauc\.? sec|saucisse seche|coppa|prosciutto|jambonneau|rillettes|pate de campagne|terrine|mousse de foie|andouille|chorizo|salami|rosette|bacon|lardons/.test(n)
){
  return 'Charcuterie';
}

/* BOUCHERIE */
if(
  /chair a saucisse|chair saucisse|boulette boeuf|boulette viande|merguez|chipolata|cote porc|cote de porc|filet poulet|filet plet|escalope|steak hache|viande hachee|aiguillette|cordon bleu volaille/.test(n)
){
  return 'Boucherie';
}

/* TRAITEUR */
if(
  /boulette vegetale|choucroute|couscous|taboule|gratin|hachis|parmentier|croque|crepe salee|galette|gnocchi|ravioli|tortellini|nem|nems|samossa|samoussa|assortiment asiatique|salade composee|ricebox|box|pasta box/.test(n)
){
  return 'Traiteur';
}

/* POISSONNERIE */
if(
  /accras de morue|tarama|saumon fume|truite fumee|hareng|maquereau|sardine|anchois|miettes crabe|chair crabe|crabe|surimi|batonnet poisson/.test(n)
){
  return 'Poissonnerie';
}

/* FRAIS / DESSERTS FRUITS */
if(
  /compote|pom\/abr|pomme abricot|pomme fraise|pomme peche|pomme poire|cerise morceaux|abricot morceaux|peche morceaux|fruit morceaux|dessert fruit/.test(n)
){
  return 'Frais';
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
  const rayonExistant = (x.rayon || '').trim();

const rayon =
  (!rayonExistant || rayonExistant === 'Autres')
    ? autoCatalogueRayon(x.nom || '')
    : rayonExistant;  

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

 function regleProduitRetroCasse(p){
  const catalogueRow = catalogue.find(
    x => String(x.code_barres || '') === String(p.barcode || '')
  );

  const rayon = String(catalogueRow?.rayon || p.department || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const nom = String(p.name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Crèmerie : rétro J-6 / casse J-5
  if(
    rayon.includes('cremerie') ||
    /yaourt|\byrt\b|yogourt|yogurt|skyr|fromage blanc/.test(nom)
  ){
    return { retro:6, casse:5, categorie:'Crèmerie' };
  }

  // Pain de mie / Charcuterie / Brioche : rétro J-5 / casse J-4
  if(
    rayon.includes('charcuterie') ||
    /pain de mie|pdm|brioche/.test(nom)
  ){
    return { retro:5, casse:4, categorie:'Pain de mie / Charcuterie / Brioche' };
  }

  // Snack / Salade : rétro J-2 / casse J-1
  if(
    /sandwich|sdw|club|wrap|burger|baguette|snack|salade|slde/.test(nom)
  ){
    return { retro:2, casse:1, categorie:'Snack / Salade' };
  }

  // Boucherie / Volaille / Saurisserie : rétro J-2 / casse J-1
  if(
    rayon.includes('boucherie') ||
    rayon.includes('volaille') ||
    rayon.includes('saurisserie') ||
    /poulet|plet|dinde|dde|boeuf|bœuf|veau|agneau|steak|escalope|volaille|saurisserie/.test(nom)
  ){
    return { retro:2, casse:1, categorie:'Boucherie / Volaille / Saurisserie' };
  }

  return null;
}

function dateMoinsJours(dateIso, jours){
  const d = new Date(dateIso + 'T00:00:00');
  d.setDate(d.getDate() - jours);
  return d;
}

function dateCourte(d){
  return new Intl.DateTimeFormat('fr-FR',{
    day:'2-digit',
    month:'2-digit',
    year:'numeric'
  }).format(d);
}

function joursAvantDlc(dateIso){
  if(!dateIso) return null;

  const aujourdHui = new Date();
  aujourdHui.setHours(0,0,0,0);

  const dlc = new Date(dateIso + 'T00:00:00');
  dlc.setHours(0,0,0,0);

  return Math.round((dlc - aujourdHui) / 86400000);
}

function charteRetroHTML(){
  return `
    <div class="card retroCharte">
      <div class="retroCharteTitle">📋 CHARTE RÉTRO / CASSE</div>

      <div class="retroCharteRow">
        <b>Crèmerie</b>
        <span>Rétro J-6 • Casse J-5</span>
      </div>

      <div class="retroCharteRow">
        <b>Pain de mie / Charcuterie / Brioche</b>
        <span>Rétro J-5 • Casse J-4</span>
      </div>

      <div class="retroCharteRow">
        <b>Snack / Salade</b>
        <span>Rétro J-2 • Casse J-1</span>
      </div>

      <div class="retroCharteRow">
        <b>Salade sachet</b>
        <span>Rétro J-2 • Casse J-1</span>
      </div>

      <div class="retroCharteRow">
        <b>Boucherie / Volaille / Saurisserie</b>
        <span>Rétro J-2 • Casse J-1</span>
      </div>

      <div class="retroPrepare">
        💡 Affichage 1 jour avant pour préparer le travail.
      </div>
    </div>
  `;
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

      const regle = regleProduitRetroCasse(p);
      if(!regle) return;

      const jours = joursAvantDlc(p.expiry);
      if(jours === null) return;

      const dateRetro = dateMoinsJours(p.expiry, regle.retro);
      const dateCasse = dateMoinsJours(p.expiry, regle.casse);

      const produit = {
        ...p,
        regle,
        jours,
        dateRetro,
        dateCasse
      };

      // Visible la veille de la rétro
      if(jours === regle.retro + 1 || jours === regle.retro){
        retro.push(produit);
      }

      // Visible la veille du passage en casse et ensuite
      if(jours <= regle.casse + 1){
        casse.push(produit);
      }
    });

  retro.sort((a,b) =>
    String(a.expiry).localeCompare(String(b.expiry))
  );

  casse.sort((a,b) =>
    String(a.expiry).localeCompare(String(b.expiry))
  );

  retroList.innerHTML =
    charteRetroHTML() +
    (retro.length
      ? retro.map(p => `
          <div class="card">
            <b>${esc(p.name || 'Produit')}</b>

            <p>
              DLC : <b>${fmt(p.expiry)}</b>
            </p>

          <div class="retroDates">

  <div class="retroDateBox">
    <span class="retroDateLabel">🟠 RÉTRO</span>
    <span class="retroDateValue">
      ${dateCourte(p.dateRetro)}
    </span>
  </div>

  <div class="casseDateBox">
    <span class="retroDateLabel">🔴 CASSE</span>
    <span class="retroDateValue">
      ${dateCourte(p.dateCasse)}
    </span>
  </div>

</div>  
          </div>
        `).join('')
      : '<div class="card">Aucun produit à préparer en rétro.</div>'
    );

  casseList.innerHTML =
    charteRetroHTML() +
    (casse.length
      ? casse.map(p => `
          <div class="card">
            <b>${esc(p.name || 'Produit')}</b>

            <p>
              DLC : <b>${fmt(p.expiry)}</b>
            </p>

   <div class="retroDates">

  <div class="retroDateBox">
    <span class="retroDateLabel">🟠 RÉTRO</span>
    <span class="retroDateValue">
      ${dateCourte(p.dateRetro)}
    </span>
  </div>

  <div class="casseDateBox">
    <span class="retroDateLabel">🔴 CASSE</span>
    <span class="retroDateValue">
      ${dateCourte(p.dateCasse)}
    </span>
  </div>

</div>         
          </div>
        `).join('')
      : '<div class="card">Aucun produit à préparer pour la casse.</div>'
    );
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
/* ===== CLASSEMENT AUTO CATALOGUE V2 ===== */

function autoCatalogueRayon(name=''){
  const n = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  /* TRAITEUR / SNACK */
  if(
    /sandwich|sdw|club|wrap|burger|baguette|pizza|quiche|lasagne|paella|couscous|cous royal|taboule|choucroute|gratin|hachis|parmentier|croque|gnocchi|ravioli|tortellini|nem|samoussa|samossa|ricebox|pasta box|boulette vegetale|blini|houmous/.test(n)
  ){
    return 'Traiteur';
  }

  /* CHARCUTERIE */
  if(
    /jambon|jbon|\bjb\b|jb cru|charcut|saucisson|sauc\.?\s*sec|saucisse seche|cervela|cervelas|andouillette|andouille|boudin|lard|lardon|bacon|chorizo|salami|mortadelle|rosette|coppa|rillettes|terrine|pate de campagne|jambonneau|coch\./.test(n)
  ){
    return 'Charcuterie';
  }

  /* POISSONNERIE */
  if(
    /saumon|thon|truite|cabillaud|colin|crevette|\bcrev\b|crev cui|morue|poisson|surimi|tarama|hareng|maquereau|sardine|anchois|crabe/.test(n)
  ){
    return 'Poissonnerie';
  }

  /* BOUCHERIE / VOLAILLE */
  if(
    /boeuf|bœuf|steak|veau|agneau|porc|poulet|\bplet\b|dinde|\bdde\b|volaille|escalope|aiguillette|chair a saucisse|chair saucisse|merguez|chipolata|cote porc|filet poulet|filet plet|viande hachee|steak hache/.test(n)
  ){
    return 'Boucherie';
  }

  /* CREMERIE / YAOURTS / FROMAGES / DESSERTS */
  if(
    /yaourt|\byrt\b|\byog\b|\byag\b|\byab\b|yogourt|skyr|danette|danonino|danone|veloute|activia|actifidus|fromage|fr\.?\s*blanc|from blanc|faisselle|petit suisse|boursin|apericube|aperivrais|camembert|brie|comte|emmental|mozza|mozzarella|chevre|raclette|reblochon|munster|roquefort|feta|parmesan|gruyere|coulommiers|maasdam|cheddar|gouda|burrata|edam|grana padano|ricotta|chaussee aux moines|fondu|fondant|tartin|beurrier|beurre|creme fraiche|cr\.?\s*fraiche|creme brulee|liegeois|douc\.?\s*satine|ile flottante|dessert lacte|mousse choco|flan|soja nature|delisse|deli'max/.test(n)
  ){
    return 'Crèmerie';
  }

  /* FRUITS / COMPOTES */
  if(
    /compote|pom\/abr|pom\/poi|pom\/pruneau|pomme abricot|pomme poire|pomme fraise|pomme peche|pomme pruneau|abricot morceaux|peche morceaux|cerise morceaux|fruit morceaux|dessert fruit/.test(n)
  ){
    return 'Frais';
  }

  return 'Autres';
}

/* ===== CLASSEMENT AUTO CATALOGUE V3 ===== */

function autoCatalogueRayon(name=''){
  const n = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  /* CRÈMERIE */
  if(
    /^croises\b|celia|chaussee aux moin|danette|danonino|danone|veloute|activia|actifidus|delisse|deli'max|yaourt|\byrt\b|\byog\b|\byag\b|\byab\b|skyr|fromage|fr\.?\s*blanc|from blanc|faisselle|petit suisse|boursin|apericube|aperivrais|camembert|brie|comte|emmental|mozza|mozzarella|chevre|raclette|reblochon|munster|roquefort|feta|parmesan|gruyere|coulommiers|maasdam|cheddar|gouda|burrata|edam|grana padano|ricotta|fondu|buche|tartin|beurrier|beurre|creme fraiche|cr\.?\s*fraiche|creme brulee|liegeois|douc\.?\s*satine|ile flottante|mousse choco|flan|soja nature|cd caramel|cd van|cd tri parf|cao van/.test(n)
  ){
    return 'Crèmerie';
  }

  /* CHARCUTERIE */
  if(
    /jambon|jbon|\bjb\b|jb cru|charcut|saucisson|sauc\.?\s*sec|saucisse seche|cervela|cervelas|andouillette|andouille|boudin|lard|lardon|bacon|chorizo|salami|mortadelle|rosette|coppa|rillettes|terrine|jambonneau|coch\./.test(n)
  ){
    return 'Charcuterie';
  }

  /* POISSONNERIE */
  if(
    /saumon|thon|truite|cabillaud|colin|crevette|\bcrev\b|crev cui|crev cuites|morue|poisson|surimi|tarama|hareng|maquereau|sardine|anchois|crabe/.test(n)
  ){
    return 'Poissonnerie';
  }

  /* BOUCHERIE / VOLAILLE */
  if(
    /boeuf|bœuf|steak|veau|agneau|porc|poulet|\bplet\b|dinde|\bdde\b|volaille|escalope|aiguillette|chair a saucisse|chair saucisse|merguez|chipolata|cote porc|filet poulet|filet plet|viande hachee|steak hache/.test(n)
  ){
    return 'Boucherie';
  }

  /* TRAITEUR / SNACK */
  if(
    /sandwich|sdw|club|wrap|burger|baguette|pizza|quiche|lasagne|paella|couscous|cous royal|taboule|choucroute|gratin|hachis|parmentier|croque|gnocchi|ravioli|tortellini|nem|samoussa|samossa|ricebox|pasta box|boulette vegetale|blini|houmous|salade composee|assortiment asiatique/.test(n)
  ){
    return 'Traiteur';
  }

  /* FRAIS / COMPOTES / FRUITS */
  if(
    /compote|d\.verger|pom\/abr|pom\/poi|pom\/pruneau|pomme abricot|pomme poire|pomme fraise|pomme peche|pomme pruneau|abricot morceaux|peche morceaux|cerise morceaux|fruit morceaux|c\/a,\s*pom|pom\/poire/.test(n)
  ){
    return 'Frais';
  }

  return 'Autres';
}
/* ===== CLASSEMENT AUTO CATALOGUE V4 ===== */

function autoCatalogueRayon(name=''){
  const n = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  /* ===== CRÈMERIE / YAOURTS / FROMAGES ===== */
  if(
    /yop|yopl|yaourt|\byrt\b|\byog\b|\byag\b|\byab\b|danette|danonino|danone|activia|actifidus|veloute|skyr|petit suisse|fr\.?\s*blanc|from\.?\s*blc|fromage|from\.|faisselle|kiri|babybel|leerdammer|mimolette|mascarpone|mme loik|lou perac|petit billy|st moret|saint moret|st agur|saint agur|brillat|cancoillotte|chaource|crottin|fourme|morbier|rocamadour|st felicien|maroilles|bleu auvergne|tomme|tomme savoie|raclet|camembert|brie|comte|emment|mozza|mozzarella|chevre|reblochon|munster|roquefort|feta|parmesan|gruyere|coulommiers|maasdam|cheddar|gouda|burrata|edam|grana|ricotta|boursin|apericube|aperivrais|rondel|ortolan|croises|coeur de creme|creme fraiche|cf epaisse|beur\.?tdre|beurre|perle lait|riz lait|sem\.?lait|snack lait|sdm choco lait|creme caramel|liegeois|ile flottante|mousse.*choc|douc\.?\s*satine|lait\.,\s*ppc|pt basq|president.*emment/.test(n)
  ){
    return 'Crèmerie';
  }

  /* ===== POISSONNERIE ===== */
  if(
    /saum|saumon|thon|truite|cabillaud|colin|crevette|\bcrev\b|morue|poisson|pois\.?pane|surimi|coraya|tarama|hareng|maquereau|anchois|sardine|crabe|moule|gambas|r\.?\s*mers|p\.?ocean|marine prov/.test(n)
  ){
    return 'Poissonnerie';
  }

  /* ===== CHARCUTERIE ===== */
  if(
    /jambon|jbon|\bjb\b|charcut|saucisson|sauc\.?\s*sec|saucisse de morteau|saucisse seche|cervela|cervelas|andouillette|andouille|boudin|lard|lardon|bacon|chorizo|salami|mortadelle|mortadel|rosette|coppa|rillettes|rillette|terrine|jambonneau|coch\.|pate camp|pate tete|mousse canard|mousse de foie|roti bf cuit|allumettes plt|des epaule|blc plt/.test(n)
  ){
    return 'Charcuterie';
  }

  /* ===== BOUCHERIE / VOLAILLE ===== */
  if(
    /boeuf|bœuf|steak|ste hache|st\.?hache|hache.*vbf|chair a saucisse|chair saucisse|veau|agneau|porc frais|escalope|filet poulet|poulet frais|volaille|saucisse volaill|tartare.*herbe/.test(n)
  ){
    return 'Boucherie';
  }

  /* ===== TRAITEUR / PLATS PRÉPARÉS / SNACK ===== */
  if(
    /xtrem|xtrembox|radiatori|marie,|sodebo|sod\.|sal\.manhattan|sal\.montmartre|sal\.roma|salade antibes|sandwich|\bsdw\b|club|wrap|burger|pizza|quich|croque|croc'maxi|tarte aux poireaux|tarte poir|tortilla|tortillas|tort\.plt|tagliat|fettuccini|ravioli|ravio\.|gnocchi|lasagne|macaroni|spagh|nouilles chinoises|riz cantonais|couscous|cous royal|taboule|choucroute|paella|gratin|hachis|parment|ricebox|pasta box|nugget|vegetal.*gourmand|knacki vegetal|tielle|esc\.milan|boulet|pate feuil|pate sablee|feuilles brick/.test(n)
  ){
    return 'Traiteur';
  }

  /* ===== FRAIS / COMPOTES / FRUITS ===== */
  if(
    /compote|d\.verger|pom\/abr|pom\/poi|pom\/pruneau|pomme abricot|pomme poire|pomme fraise|pomme peche|pomme pruneau|abricot morceaux|peche morceaux|cerise morceaux|fruit morceaux|mini max sav fruits|panier.*abricot|panier.*nect/.test(n)
  ){
    return 'Frais';
  }

  return 'Autres';
}
/* ===== BOUTON RETOUR GLOBAL ===== */

(() => {
  const historiqueVues = [];

  function vueActuelle() {
    const vues = [...document.querySelectorAll('[id$="View"]')];

    return vues.find(v => {
      const style = getComputedStyle(v);
      return !v.hidden &&
             style.display !== 'none' &&
             !v.classList.contains('hidden');
    });
  }

  /* Mémorise la page avant d'en ouvrir une autre */
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-view]');
    if (!btn || btn.classList.contains('globalBackBtn')) return;

    const actuelle = vueActuelle();
    const prochaine = btn.dataset.view;

    if (
      actuelle &&
      actuelle.id !== prochaine &&
      actuelle.id !== 'loginView'
    ) {
      historiqueVues.push({
        id: actuelle.id,
        scroll: window.scrollY
      });
    }
  }, true);

  /* Ajoute automatiquement Retour aux pages secondaires */
  function ajouterBoutonsRetour() {
    document.querySelectorAll('[id$="View"]').forEach(view => {

      if (
        view.id === 'homeView' ||
        view.id === 'loginView' ||
        view.id === 'productDetailView'
      ) return;

      if (view.querySelector('.globalBackBtn')) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'globalBackBtn';
      btn.innerHTML = '← Retour';

      btn.addEventListener('click', () => {
        const precedent = historiqueVues.pop();

        if (precedent && document.getElementById(precedent.id)) {
          show(precedent.id);

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.scrollTo(0, precedent.scroll || 0);
            });
          });

        } else {
          show('homeView');
          window.scrollTo(0, 0);
        }
      });

      view.insertBefore(btn, view.firstChild);
    });
  }

  /* Style du bouton */
  const style = document.createElement('style');
  style.textContent = `
    .globalBackBtn{
      display:flex;
      align-items:center;
      gap:6px;
      border:0;
      background:transparent;
      color:#12345b;
      font-size:16px;
      font-weight:700;
      padding:12px 4px;
      margin:0 0 8px 0;
      cursor:pointer;
    }

    .globalBackBtn:active{
      opacity:.6;
    }
  `;

  document.head.appendChild(style);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ajouterBoutonsRetour);
  } else {
    ajouterBoutonsRetour();
  }
})();
/* ===== CLASSEMENT AUTO CATALOGUE V5 ===== */

/* ===== CLASSEMENT AUTO CATALOGUE V7 ===== */

function autoCatalogueRayon(name = '') {
  const n = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  /* ===== PAIN DE MIE ===== */
  if (
    /pain de mie|\bpdm\b|harrys.*mie|jacquet.*mie|mie complet|mie nature|mie cereal/.test(n)
  ) {
    return 'Pain de mie';
  }

  /* ===== BRIOCHE ===== */
  if (
    /brioche|briochette|gache|pain au lait|pain lait|pitch|doo wap|croissant|pain chocolat|pains chocolat|chinois|beignet|pancake|madeleine|moelleux|quatre quart|barre patissiere|crepe|gaufre/.test(n)
  ) {
    return 'Brioche';
  }

  /* ===== SAUCISSON ===== */
  if (
    /saucisson|sauc sec|saucisse seche|rosette|fuet|chorizo|baton berger|stick.*sec/.test(n)
  ) {
    return 'Saucisson';
  }

  /* ===== BÉBÉ ===== */
  if (
    /bebe|baby|bledina|blediner|bledichef|bledidej|bledi|gallia|calisma|galliagest|naturnes|babybio|hipp|petit pot|ptit gourmand|p brasse|lait croissance|babicao|babivanille|mon prem biscuit|1er biscuit|1er boudoir/.test(n)
  ) {
    return 'Bébé';
  }

  /* ===== TRAITEUR / SNACK ===== */
  if (
    /sodebo|\bsod\b|sandwich|\bsdw\b|club|wrap|burger|pizza|quich|croque|tortilla|tagliat|fettuccini|ravioli|gnocchi|lasagne|macaroni|spaghetti|nouilles|riz cantonais|couscous|taboule|choucroute|paella|gratin|hachis|parment|ricebox|pasta box|nugget|tielle|boulette|salade|sal\.|pate feuil|pate sablee|brick|coleslaw|piemont|macedoine|salade d alaska|salade de betterave|salade museau|salade cervelas|celeri remoulade|torti.*surimi|taboulet|ecrase.*pdt|puree.*crealine|houmous|guacamole|tzatziki|ktipiti/.test(n)
  ) {
    return 'Traiteur';
  }

  /* ===== POISSONNERIE ===== */
  if (
    /saumon|\bsaum\b|thon|truite|cabillaud|colin|crevette|\bcrev\b|morue|poisson|surimi|coraya|tarama|hareng|maquereau|anchois|sardine|crabe|moule|gambas/.test(n)
  ) {
    return 'Poissonnerie';
  }

  /* ===== BOUCHERIE / VOLAILLE ===== */
  if (
    /\bboeuf\b|brochette.*boeuf|steak|ste hache|hache.*vbf|chair.*saucisse|veau|agneau|porc frais|escalope|filet poulet|poulet frais|volaille|dinde|canard frais|tartare.*herbe/.test(n)
  ) {
    return 'Boucherie';
  }

  /* ===== CHARCUTERIE ===== */
  if (
    /jambon|jbon|\bjb\b|charcut|cervela|andouillette|andouille|boudin|lard|lardon|bacon|salami|mortadelle|coppa|rillettes|terrine|jambonneau|mousse canard|mousse foie|roti.*cuit|epaule/.test(n)
  ) {
    return 'Charcuterie';
  }

  /* ===== CRÈMERIE ===== */
  if (
    /yop|yoplait|yaourt|\byrt\b|\byog\b|danette|danonino|danone|activia|actimel|skyr|petit suisse|fromage|faisselle|kiri|babybel|leerdammer|mimolette|mascarpone|st moret|saint moret|st agur|fourme|morbier|raclette|camembert|brie|comte|emmental|mozza|mozzarella|chevre|reblochon|munster|roquefort|feta|parmesan|gruyere|cheddar|gouda|burrata|ricotta|boursin|creme fraiche|beurre|riz lait|liegeois|mousse.*choc/.test(n)
  ) {
    return 'Crèmerie';
  }

  /* ===== JUS FRAIS ===== */
if (
  /danao|sunny d|innoc|tropicana|jaf\.?|pur jus|jus orange|jus oran|jus pomme|jus ananas|jus multi|jus pom|smooth|mojito sans alcool|boisson cit|matin fruite/.test(n)
) {
  return 'Jus frais';
}

/* ===== SALADES ===== */
if (
  /coeur.*laitue|coeurs.*laitue|iceberg|jeunes pousses|mache|roquette|batavia|feuille chene|melange gourmand|carottes rapees|melange croquant|baby carrots|croq.*radis/.test(n)
) {
  return 'Salades';
}

  /* ===== ŒUFS ===== */
  if (
    /\boeufs?\b/.test(n)
  ) {
    return 'Œufs';
  }

  return 'Autres';
}
/* ===== CASES RAYONS CATALOGUE V1 ===== */

(() => {
  const rayonsCatalogue = [
    ['Tous', '📦'],
    ['Crèmerie', '🥛'],
    ['Charcuterie', '🥓'],
    ['Boucherie', '🥩'],
    ['Poissonnerie', '🐟'],
    ['Traiteur', '🍽️'],
    ['Jus frais', '🧃'],
    ['Salades', '🥗'],
    ['Pain de mie', '🍞'],
    ['Œufs', '🥚'],
    ['Brioche', '🥐'],
    ['Saucisson', '🌭'],
    ['Bébé', '🍼'],
    ['Autres', '📋']
  ];

  let rayonCatalogueActif = 'Tous';

  function ajouterCasesRayons() {
    const vue = document.getElementById('catalogueView');
    if (!vue || document.getElementById('catalogueRayonCases')) return;

    const recherche =
      vue.querySelector('input[type="search"]') ||
      vue.querySelector('input[placeholder*="Recher"]');

    const zone = document.createElement('div');
    zone.id = 'catalogueRayonCases';
    zone.className = 'catalogueRayonCases';

    zone.innerHTML = rayonsCatalogue.map(([nom, icone]) => `
      <button
        type="button"
        class="catalogueRayonCase ${nom === 'Tous' ? 'active' : ''}"
        data-catalogue-rayon="${nom}">
        <span>${icone}</span>
        <strong>${nom}</strong>
      </button>
    `).join('');

    if (recherche) {
      recherche.parentElement.insertAdjacentElement('afterend', zone);
    } else {
      vue.insertBefore(zone, vue.firstChild);
    }
  }

  document.addEventListener('click', e => {
    const bouton = e.target.closest('[data-catalogue-rayon]');
    if (!bouton) return;

    rayonCatalogueActif = bouton.dataset.catalogueRayon;
if (rayonCatalogueActif !== 'Tous') {
  afficherProduitsRayon(rayonCatalogueActif);
  return;
}
    document.querySelectorAll('.catalogueRayonCase').forEach(b => {
      b.classList.toggle(
        'active',
        b.dataset.catalogueRayon === rayonCatalogueActif
      );
    });

    document.querySelectorAll('#catalogueView [data-cat-id]').forEach(carte => {
      const id = String(carte.dataset.catId || '');
      const produit = catalogue.find(p => String(p.id) === id);

      if (!produit) return;

      const rayonExistant = (produit.rayon || '').trim();

      const rayon =
        (!rayonExistant || rayonExistant === 'Autres')
          ? autoCatalogueRayon(produit.nom || '')
          : rayonExistant;

      carte.style.display =
        rayonCatalogueActif === 'Tous' || rayon === rayonCatalogueActif
          ? ''
          : 'none';
    });
  });

  const style = document.createElement('style');

  style.textContent = `
    .catalogueRayonCases{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:10px;
      margin:14px 0 18px;
    }

    .catalogueRayonCase{
      min-height:74px;
      border:1px solid #dce4ec;
      border-radius:16px;
      background:#fff;
      color:#12345b;
      display:flex;
      align-items:center;
      gap:10px;
      padding:12px;
      text-align:left;
      box-shadow:0 3px 10px rgba(0,0,0,.06);
    }

    .catalogueRayonCase span{
      font-size:27px;
    }

    .catalogueRayonCase strong{
      font-size:15px;
    }

    .catalogueRayonCase.active{
      border:2px solid #12345b;
      background:#eef5fb;
    }
  `;

  document.head.appendChild(style);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ajouterCasesRayons);
  } else {
    ajouterCasesRayons();
  }
})();
/* ===== ANTI-SAUT IMAGES V1 ===== */
const loadProductsOriginal = loadProducts;

loadProducts = async function(silent = false) {
  if (!db || !magasinId) return;

  const { data, error } = await db
    .from('produits')
    .select('*')
    .eq('magasin_id', magasinId)
    .order('dlc', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (!silent) toast('Mode hors ligne : données du téléphone');
    console.error(error);
    return;
  }

  const nouveauxProduits = (data || []).map(mapRow);

  if (JSON.stringify(nouveauxProduits) === JSON.stringify(products)) {
    return;
  }

  products = nouveauxProduits;
  saveLocal();
  render();
};
/* ===== ANTI-SAUT CATALOGUE V2 ===== */

let catalogueDernierAffichage = '';

const renderCatalogueOriginal = renderCatalogue;

renderCatalogue = function() {
  if (!$('catalogueList')) return;

  const q = ($('catalogueSearch')?.value || '')
    .trim()
    .toLowerCase();

  const signature = JSON.stringify(
    catalogue.map(x => [
      x.id,
      x.nom,
      x.code_barres,
      x.rayon,
      x.photo_url
    ])
  ) + '|' + q;

  if (signature === catalogueDernierAffichage) {
    return;
  }

  catalogueDernierAffichage = signature;
  renderCatalogueOriginal();
};
/* ===== PHOTOS SANS SAUT V3 ===== */

enrichMissingPhotos = async function(limit = 60) {
  if (!navigator.onLine || !isAdmin()) return;

  const missing = catalogue
    .filter(x => !x.photo_url && x.code_barres)
    .slice(0, limit);

  let changement = false;

  for (const row of missing) {
    const off = await lookupOpenFoodFacts(row.code_barres);

    if (off?.photo_url) {
      row.photo_url = off.photo_url;
      changement = true;

      try {
        await db
          .from('catalogue_produits')
          .update({
            photo_url: off.photo_url,
            updated_at: new Date().toISOString()
          })
          .eq('id', row.id)
          .eq('magasin_id', magasinId);
      } catch (e) {
        console.warn('Photo catalogue:', e);
      }
    }
  }

  if (changement) {
    saveCatalogueLocal();
  }
};
/* ===== PHOTO MANUELLE PRODUIT V1 ===== */

let produitPhotoEnCours = null;

document.addEventListener('click', e => {
  const bouton = e.target.closest('[data-photo-produit]');
  if (!bouton) return;

  e.preventDefault();
  e.stopPropagation();

  produitPhotoEnCours = bouton.dataset.photoProduit;

  const input = document.getElementById('productPhotoInput');
  if (input) {
    input.value = '';
    input.click();
  }
});

document.getElementById('productPhotoInput')?.addEventListener('change', async e => {
  const fichier = e.target.files?.[0];
  if (!fichier || !produitPhotoEnCours) return;

  toast('Photo sélectionnée');
});
/* ===== BOUTON PHOTO SUR PRODUITS V1 ===== */

const renderCatalogueAvecPhoto = renderCatalogue;

renderCatalogue = function() {
  renderCatalogueAvecPhoto();

  document.querySelectorAll('#catalogueList [data-cat-id]').forEach(carte => {
    if (carte.querySelector('[data-photo-produit]')) return;

    const id = carte.dataset.catId;
    const produit = catalogue.find(x => String(x.id) === String(id));
    if (!produit) return;

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'boutonPhotoProduit';
    bouton.dataset.photoProduit = produit.code_barres;
    bouton.innerHTML = produit.photo_url ? '📷' : '📷＋';
    bouton.title = produit.photo_url ? 'Modifier la photo' : 'Ajouter une photo';

    carte.appendChild(bouton);
  });
};
/* ===== PAGE RAYON CATALOGUE V2 ===== */

let catalogueRayonMode = null;

function rayonReelProduit(produit) {
  const rayonExistant = (produit.rayon || '').trim();

return (!rayonExistant || rayonExistant === 'Autres' || rayonExistant === 'Frais')
    ? autoCatalogueRayon(produit.nom || '')
    : rayonExistant;
}

function afficherProduitsRayon(nomRayon) {
 show('catalogueView'); 
  catalogueRayonMode = nomRayon;

  const zoneRayons = document.getElementById('catalogueRayonCases');
  const liste = document.getElementById('catalogueList');
  const recherche = document.getElementById('catalogueSearch');

  if (!liste) return;

  if (zoneRayons) zoneRayons.style.display = 'none';

  let entete = document.getElementById('catalogueRayonHeader');

  if (!entete) {
    entete = document.createElement('div');
    entete.id = 'catalogueRayonHeader';

    liste.parentElement.insertBefore(entete, liste);
  }

  entete.style.display = 'block';

  const q = (recherche?.value || '').trim().toLowerCase();

  let produitsRayon = catalogue.filter(produit => {
    const rayon = rayonReelProduit(produit);

    const correspondRayon =
      nomRayon === 'Tous' || rayon === nomRayon;

    const correspondRecherche =
      !q ||
      (produit.nom || '').toLowerCase().includes(q) ||
      String(produit.code_barres || '').includes(q);

    return correspondRayon && correspondRecherche;
  });

  produitsRayon.sort((a, b) =>
    String(a.nom || '').localeCompare(String(b.nom || ''), 'fr')
  );

  entete.innerHTML = `
    <button type="button" id="retourRayonsCatalogue">
      ← Retour aux rayons
    </button>

    <div class="catalogueRayonTitre">
      <h2>${nomRayon}</h2>
      <span>${produitsRayon.length} produit${produitsRayon.length > 1 ? 's' : ''}</span>
    </div>
  `;

  liste.innerHTML = produitsRayon.length
    ? produitsRayon.map(produit => `
        <button
          type="button"
          class="catalogueItem"
          data-cat-id="${produit.id}"
        >
          <span class="eanIcon cataloguePhotoBox">
            ${
              produit.photo_url
                ? `<img
                    src="${esc(produit.photo_url)}"
                    alt="${esc(produit.nom)}"
                    loading="lazy"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"
                  >
                  <span class="photoFallback" style="display:none">▥</span>`
                : `<span class="photoFallback">▥</span>`
            }
          </span>

          <span class="catInfo">
            <b>${esc(produit.nom)}</b>
            <small>
              EAN ${esc(produit.code_barres || '')}
              · ${esc(rayonReelProduit(produit))}
            </small>
          </span>

          <button
            type="button"
            class="boutonPhotoProduit"
            data-photo-produit="${esc(produit.code_barres || '')}"
            title="${produit.photo_url ? 'Modifier la photo' : 'Ajouter une photo'}"
          >
            ${produit.photo_url ? '📷' : '📷＋'}
          </button>

          <span class="chev">›</span>
        </button>
      `).join('')
    : `<p class="muted">Aucun produit dans ce rayon.</p>`;
}

document.addEventListener(
  'click',
  e => {
    const rayonBtn = e.target.closest('[data-catalogue-rayon]');

    if (rayonBtn) {
      e.preventDefault();
      e.stopImmediatePropagation();

      afficherProduitsRayon(
        rayonBtn.dataset.catalogueRayon
      );

      window.scrollTo({
        top: document.getElementById('catalogueView')?.offsetTop || 0,
        behavior: 'smooth'
      });

      return;
    }

    const retour = e.target.closest('#retourRayonsCatalogue');

    if (retour) {
      e.preventDefault();
      e.stopImmediatePropagation();

      catalogueRayonMode = null;

      const zoneRayons = document.getElementById('catalogueRayonCases');
      const entete = document.getElementById('catalogueRayonHeader');

      if (zoneRayons) zoneRayons.style.display = 'grid';
      if (entete) entete.style.display = 'none';

      renderCatalogue();

      window.scrollTo({
        top: document.getElementById('catalogueView')?.offsetTop || 0,
        behavior: 'smooth'
      });
    }
  },
  true
);

document.addEventListener(
  'input',
  e => {
    if (
      catalogueRayonMode &&
      e.target?.id === 'catalogueSearch'
    ) {
      e.stopImmediatePropagation();
      afficherProduitsRayon(catalogueRayonMode);
    }
  },
  true
);
/* ===== NETTOYAGE AFFICHAGE CATALOGUE ===== */

function nettoyerAffichageCatalogue() {
  const vue = document.getElementById('catalogueView');
  if (!vue) return;

  // Cache le bouton Retour global en trop dans le catalogue
  const boutonsRetour = vue.querySelectorAll('.globalBackBtn');
  boutonsRetour.forEach(btn => {
    btn.style.display = 'none';
  });

  // Retire les petits chevrons > isolés entre les produits
  vue.querySelectorAll('.chev').forEach(el => {
    el.style.display = 'none';
  });
}

document.addEventListener('click', () => {
  setTimeout(nettoyerAffichageCatalogue, 50);
});

setTimeout(nettoyerAffichageCatalogue, 300);
/* ===== BLOQUER LE RERENDER DANS UNE PAGE RAYON ===== */

const renderCatalogueAvantModeRayon = renderCatalogue;

renderCatalogue = function() {
  if (catalogueRayonMode) {
    afficherProduitsRayon(catalogueRayonMode);
    return;
  }

  renderCatalogueAvantModeRayon();
};
// ===== OUVERTURE DIRECTE D'UN RAYON =====
document.addEventListener('click', function(e) {
  const rayon = e.target.closest('[data-rayon]');
  if (!rayon) return;

  const nomRayon = rayon.getAttribute('data-rayon');
  if (!nomRayon) return;

  catalogueRayonMode = nomRayon;
  afficherProduitsRayon(nomRayon);
});
const employeeLoginBtn = $('employeeLoginBtn');

if (employeeLoginBtn) {
  employeeLoginBtn.addEventListener('click', async () => {
    const code = $('employeeCode').value.trim();
    const message = $('employeeLoginError');

    if (!code) {
      message.textContent = 'Entrez votre code personnel.';
      return;
    }

    message.textContent = 'Connexion…';

    try {
      const employe = await connecterEmploye(code);

      message.textContent = '';
      $('employeeCode').value = '';

      $('employeeLogin').classList.add('hidden');
      $('app').classList.remove('hidden');
applyRoleUI();
      toast('Bonjour ' + employe.nom + ' 👋');
    } catch (e) {
      console.error(e);
      message.textContent = 'Code personnel incorrect.';
    }
  });
}
/* ===== HISTORIQUE COMPLET ACTIVITÉ EMPLOYÉS V1 ===== */

async function enregistrerActivite(action, details = '') {
  if (!db || !magasinId || !employeConnecte?.id) return;

  try {
    const { error } = await db.rpc('enregistrer_activite', {
      p_magasin_id: Number(magasinId),
      p_employe_id: Number(employeConnecte.id),
      p_action: String(action),
      p_details: details ? String(details).slice(0, 500) : null
    });

    if (error) {
      console.warn('Historique activité :', error);
    }
  } catch (e) {
    console.warn('Historique activité :', e);
  }
}

/* AJOUT D'UNE DLC */
const addProductSmartHistorique = addProductSmart;

addProductSmart = async function(p) {
  const resultat = await addProductSmartHistorique(p);

  await enregistrerActivite(
    'Ajout DLC',
    `${p.name || 'Produit'} · DLC ${p.expiry || '-'} · Qté ${p.quantity || 1}${p.barcode ? ' · EAN ' + p.barcode : ''}`
  );

  return resultat;
};

/* SUPPRESSION D'UNE DLC */
const deleteProductSmartHistorique = deleteProductSmart;

deleteProductSmart = async function(p) {
  const id = p?.id;

  const details =
    `${p?.name || 'Produit'} · DLC ${p?.expiry || '-'} · Qté ${p?.quantity || 1}` +
    `${p?.barcode ? ' · EAN ' + p.barcode : ''}`;

  const resultat = await deleteProductSmartHistorique(p);

  const existeEncore = products.some(
    x => String(x.id) === String(id)
  );

  if (!existeEncore) {
    await enregistrerActivite(
      'Suppression DLC',
      details
    );
  }

  return resultat;
};

/* PRODUIT RETIRÉ / REMIS EN ATTENTE */
const setDoneRemoteHistorique = setDoneRemote;

setDoneRemote = async function(id, done) {
  const produit = products.find(
    x => String(x.id) === String(id)
  );

  const resultat =
    await setDoneRemoteHistorique(id, done);

  await enregistrerActivite(
    done
      ? 'Produit retiré'
      : 'Produit remis en attente',

    `${produit?.name || 'Produit'} · DLC ${produit?.expiry || '-'} · Qté ${produit?.quantity || 1}${produit?.barcode ? ' · EAN ' + produit.barcode : ''}`
  );

  return resultat;
};

/* ACTUALISER L'HISTORIQUE */
const refreshActivityHistorique =
  document.getElementById('refreshActivity');

if (refreshActivityHistorique) {
  refreshActivityHistorique.addEventListener(
    'click',
    () => loadActivity()
  );
}
/* ===== RAYONS UNIQUEMENT DANS PRODUITS V82 ===== */

function placerRayonsDansProduits() {
  const zone = document.getElementById('catalogueRayonCases');
  const produitsView = document.getElementById('productsView');
  const listeProduits = document.getElementById('productList');

  if (!zone || !produitsView) return;

  if (listeProduits) {
    produitsView.insertBefore(zone, listeProduits);
  } else {
    produitsView.appendChild(zone);
  }
}

document.addEventListener('click', () => {
  setTimeout(placerRayonsDansProduits, 50);
});

setTimeout(placerRayonsDansProduits, 300);
/* ===== DLC SANS QUANTITE + AFFICHAGE EAN V83 ===== */

/* Une ligne = uniquement une date de DLC */
dlcRowHTML = function(date = iso(today()), qtyValue = 1, removable = true) {
  return `
    <div class="dlcEntry dlcEntryV83">
      <label>
        Date de DLC
        <input class="dlcDate" type="date" required value="${esc(date)}">
      </label>

      <button
        type="button"
        class="removeDlcRow ${removable ? '' : 'hidden'}"
        aria-label="Supprimer cette date"
      >×</button>
    </div>
  `;
};

/* Remet une première date sans quantité */
resetDlcRows = function(date = iso(today()), qtyValue = 1) {
  const box = $('dlcRows');
  if (!box) return;

  box.innerHTML = dlcRowHTML(date, 1, false);
  refreshDlcRemoveButtons();
};

/* Affichage des produits :
   - nom
   - EAN
   - rayon
   - dates
   - aucune quantité
*/
productGroupHTML = function(g) {
  const items = [...g.items].sort(
    (a, b) => String(a.expiry).localeCompare(String(b.expiry))
  );

  return `
    <div class="productGroup">

      <div class="productGroupTop">
        <div class="groupPhoto">
          ${productPhotoHTML(g.barcode, g.name)}
        </div>

        <div class="pinfo">
          <b>${esc(g.name)}</b>

          ${
            g.barcode
              ? `<small class="productEAN">EAN : ${esc(g.barcode)}</small>`
              : `<small class="productEAN">EAN non renseigné</small>`
          }

          <small>${esc(g.department)}</small>
        </div>
      </div>

      <div class="dlcMiniList">
        ${items.map(p => {
          const [s, c] = status(p);

          return `
            <div class="dlcMiniRow">
              <div>
                <span class="badge ${c}">${s}</span>
                <b>${fmt(p.expiry)}</b>
              </div>

              <button data-delete-product="${p.id}">
                Supprimer
              </button>
            </div>
          `;
        }).join('')}
      </div>

      <button
        class="addGroupDlc"
        data-add-date="${items[0]?.id || ''}"
      >
        ＋ Ajouter une DLC
      </button>

    </div>
  `;
};

/* Même si l'ancienne interface transmet une quantité,
   chaque DLC est maintenant enregistrée comme 1 date */
const addProductRemoteV83 = addProductRemote;

addProductRemote = async function(p, noReload = false) {
  p.quantity = 1;
  return await addProductRemoteV83(p, noReload);
};

/* Masque les anciens éléments quantité encore présents dans le HTML */
function retirerQuantitesV83() {
  document.querySelectorAll('.dlcEntry').forEach(row => {
    row.querySelectorAll('label').forEach(label => {
      if (/quantité/i.test(label.textContent || '')) {
        label.style.display = 'none';
      }
    });

    row.querySelectorAll('.quantity, .compactQty, .dlcQty').forEach(el => {
      el.style.display = 'none';
    });
  });

  document.querySelectorAll('.groupQty').forEach(el => {
    el.style.display = 'none';
  });
}

/* Nettoyage automatique après les changements d'écran */
document.addEventListener('click', () => {
  setTimeout(retirerQuantitesV83, 50);
});

setTimeout(retirerQuantitesV83, 300);
/* ===== AFFICHAGE EAN DANS TOUTES LES LISTES DLC V84 ===== */

function ajouterEANListesV84() {
  const zones = [
    'dailyList',
    'planningList',
    'productList',
    'retroList',
    'casseList',
    'homeRecent'
  ];

  zones.forEach(zoneId => {
    const zone = document.getElementById(zoneId);
    if (!zone) return;

    /* Recherche les lignes/cartes contenant une DLC */
    zone.querySelectorAll(
      '.item, .productRow, .dailyItem, .planningItem, .planningProduct, .retroItem, .casseItem, .dlcMiniRow'
    ).forEach(card => {

      /* Évite d'ajouter deux fois l'EAN */
      if (card.querySelector('.eanV84')) return;

      /* Recherche le produit correspondant grâce à son nom */
      const texte = (card.textContent || '').toLowerCase();

      const produit = products.find(p => {
        const nom = String(p.name || '').trim().toLowerCase();
        return nom && texte.includes(nom);
      });

      if (!produit?.barcode) return;

      const info = card.querySelector(
        '.pinfo, .productInfo, .dailyInfo, .planningInfo'
      ) || card.querySelector('div');

      if (!info) return;

      const ean = document.createElement('small');
      ean.className = 'eanV84';
      ean.textContent = 'EAN : ' + produit.barcode;

      info.appendChild(ean);
    });
  });
}

function actualiserEANV84() {
  setTimeout(ajouterEANListesV84, 100);
  setTimeout(ajouterEANListesV84, 400);
}

/* À chaque changement de page */
document.addEventListener('click', actualiserEANV84);

/* Après les mises à jour automatiques */
const renderEANV84 = render;
render = function() {
  const resultat = renderEANV84.apply(this, arguments);
  actualiserEANV84();
  return resultat;
};

/* Premier affichage */
actualiserEANV84();
/* ===== AFFICHER LES DLC DEJA ENREGISTREES V84 ===== */

function afficherDlcExistantesV84() {
  const form = document.getElementById('productForm');
  const barcodeInput = document.getElementById('barcode');
  const dlcRows = document.getElementById('dlcRows');

  if (!form || !barcodeInput || !dlcRows) return;

  let zone = document.getElementById('existingDlcV84');

  if (!zone) {
    zone = document.createElement('div');
    zone.id = 'existingDlcV84';
    zone.className = 'existingDlcV84';

    dlcRows.parentElement.appendChild(zone);
  }

  const code = String(barcodeInput.value || '').trim();

  if (!code) {
    zone.innerHTML = '';
    zone.style.display = 'none';
    return;
  }

  const dates = products
    .filter(p =>
      String(p.barcode || '').trim() === code &&
      !p.done &&
      p.expiry
    )
    .map(p => p.expiry)
    .filter((date, index, array) => array.indexOf(date) === index)
    .sort();

  if (!dates.length) {
    zone.innerHTML = `
      <div class="existingDlcTitle">
        Dates déjà enregistrées
      </div>
      <small>Aucune DLC enregistrée pour ce produit.</small>
    `;
    zone.style.display = 'block';
    return;
  }

  zone.innerHTML = `
    <div class="existingDlcTitle">
      Dates déjà enregistrées
    </div>

    <div class="existingDlcDates">
      ${dates.map(date => `
        <div class="existingDlcDate">
          📅 ${fmt(date)}
        </div>
      `).join('')}
    </div>
  `;

  zone.style.display = 'block';
}


/* Actualise les dates lorsqu'un produit est ouvert */
function actualiserDlcExistantesV84() {
  setTimeout(afficherDlcExistantesV84, 100);
  setTimeout(afficherDlcExistantesV84, 400);
}

document.addEventListener('click', actualiserDlcExistantesV84);


/* Si l'EAN change manuellement */
const barcodeV84 = document.getElementById('barcode');

if (barcodeV84) {
  barcodeV84.addEventListener(
    'input',
    afficherDlcExistantesV84
  );
}


/* Premier contrôle */
actualiserDlcExistantesV84();
/* ===== CORRECTION FICHE PRODUIT QUI REVIENT AU RAYON V86 ===== */

document.addEventListener('click', e => {
  const produit = e.target.closest('.catalogueItem[data-cat-id]');
  if (!produit) return;

  // On quitte temporairement le mode rayon pendant l'ouverture de la fiche
  catalogueRayonMode = null;
}, true);
/* ===== V90 - RAYON AUTOMATIQUE PAR EAN ===== */

const addProductSmartAvantRayonV90 = addProductSmart;

addProductSmart = async function(p) {

  const ean = String(p.barcode || '').trim();

  if (ean) {
    const produitCatalogue = catalogue.find(
      x => String(x.code_barres || '').trim() === ean
    );

    if (produitCatalogue?.rayon) {
      p = {
        ...p,
        department: produitCatalogue.rayon
      };
    }
  }

  return await addProductSmartAvantRayonV90(p);
};
/* ===== V90 - EAN SOUS LES PRODUITS ===== */

function afficherEANPartoutV90() {
  const zones = [
    'productList',
    'dailyList',
    'planningList',
    'retroList',
    'casseList',
    'homeRecent'
  ];

  zones.forEach(zoneId => {
    const zone = document.getElementById(zoneId);
    if (!zone) return;

    const cartes = zone.querySelectorAll(
      '.product, .card, .planningProduct, button[data-add-date]'
    );

    cartes.forEach(carte => {
      if (carte.querySelector('.eanV90')) return;

      const texte = String(carte.textContent || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      const produit = products.find(p => {
        const nom = String(p.name || '')
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');

        return nom && texte.includes(nom);
      });

      if (!produit?.barcode) return;

      const nomElement =
        carte.querySelector('.pinfo b') ||
        carte.querySelector('.planningProduct b') ||
        carte.querySelector('b');

      if (!nomElement) return;

      const ean = document.createElement('small');
      ean.className = 'eanV90';
      ean.textContent = 'EAN : ' + produit.barcode;

      ean.style.display = 'block';
      ean.style.marginTop = '4px';
      ean.style.fontSize = '12px';
      ean.style.fontWeight = '500';
      ean.style.color = '#6b7c89';

      nomElement.insertAdjacentElement('afterend', ean);
    });
  });
}

function actualiserEANPartoutV90() {
  setTimeout(afficherEANPartoutV90, 100);
  setTimeout(afficherEANPartoutV90, 400);
}

document.addEventListener('click', actualiserEANPartoutV90);

setTimeout(afficherEANPartoutV90, 500);
