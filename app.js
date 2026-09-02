const KEY="fraisProxiProductsV3", STORE="fraisProxiStoreV3", STARTED="fraisProxiStartedV3";
let products=JSON.parse(localStorage.getItem(KEY)||"[]");
let selectedDate=new Date();selectedDate.setHours(0,0,0,0);
let activeFilter="all", dailyMode="today", codeReader=null, scannerRunning=false;
const $=id=>document.getElementById(id), $$=s=>[...document.querySelectorAll(s)];
const toISO=d=>{const x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,10)};
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const fmt=d=>new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(d));
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
function monday(d){const x=new Date(d),n=(x.getDay()+6)%7;x.setDate(x.getDate()-n);x.setHours(0,0,0,0);return x}
function sunday(d){const x=monday(d);x.setDate(x.getDate()+6);x.setHours(23,59,59,999);return x}
function qty(a){return a.reduce((n,p)=>n+(+p.quantity||0),0)}
function save(){localStorage.setItem(KEY,JSON.stringify(products))}
function status(p){
  if(p.done)return["Retiré","green"];
  const e=new Date(p.expiry+"T00:00:00"),t=new Date(toISO(selectedDate)+"T00:00:00");
  const diff=Math.round((e-t)/86400000);
  if(diff<=0)return["À retirer aujourd'hui","red"];
  if(diff===1)return["Demain","amber"];
  if(e<=sunday(selectedDate))return["Cette semaine","green"];
  return["À venir","green"];
}
function icon(d){return({Frais:"🥬",Crèmerie:"🥛",Charcuterie:"🥩",Traiteur:"🍗",Épicerie:"🛒",Boucherie:"🥩",Poissonnerie:"🐟",Autre:"📦"})[d]||"📦"}
function storeName(){return localStorage.getItem(STORE)||"Proxi - Mon magasin"}
function updateStore(){ $("storeName").textContent=storeName();$("settingsStore").textContent=storeName() }
function showView(id){
  $$(".view").forEach(v=>v.classList.remove("active"));$(id).classList.add("active");
  $$(".nav").forEach(n=>n.classList.toggle("active",n.dataset.view===id));
  if(id==="scanView")startCamera();else stopCamera();window.scrollTo(0,0)
}
function toast(t){$("toast").textContent=t;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),1800)}
function render(){
  $("currentDate").textContent=new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(selectedDate);
  const a=products.filter(p=>!p.done);
  $("todayCount").textContent=qty(a.filter(p=>status(p)[1]==="red"));
  $("tomorrowCount").textContent=qty(a.filter(p=>status(p)[1]==="amber"));
  $("weekCount").textContent=qty(a.filter(p=>{const d=new Date(p.expiry+"T00:00:00");return d>=monday(selectedDate)&&d<=sunday(selectedDate)}));
  renderUpcoming();renderProducts();renderDaily();renderStats()
}
function renderUpcoming(){
  const labs=["Lun","Mar","Mer","Jeu","Ven"],m=monday(selectedDate);
  $("upcoming").innerHTML=labs.map((l,i)=>{const d=addDays(m,i),n=qty(products.filter(p=>!p.done&&toISO(new Date(p.expiry))===toISO(d)));return`<div class="day ${toISO(d)===toISO(selectedDate)?"active":""}"><b>${l}</b><span>${d.getDate()}</span><strong>${n}</strong></div>`}).join("")
}
function matches(p){
  const term=$("search").value.trim().toLowerCase();
  if(term&&!(`${p.name} ${p.department} ${p.barcode||""}`.toLowerCase().includes(term)))return false;
  if(activeFilter==="all")return true;
  if(activeFilter==="today")return status(p)[1]==="red"&&!p.done;
  if(activeFilter==="tomorrow")return status(p)[1]==="amber"&&!p.done;
  if(activeFilter==="week"){const d=new Date(p.expiry+"T00:00:00");return d>=monday(selectedDate)&&d<=sunday(selectedDate)&&!p.done}
  return true
}
function productHTML(p){
  const [lab,cl]=status(p);
  return`<div class="product"><div class="prod-icon">${icon(p.department)}</div><div class="prod-info"><b>${esc(p.name)} ×${p.quantity}</b><div class="meta">${esc(p.department)} · DLC ${fmt(p.expiry)}${p.barcode?` · ${esc(p.barcode)}`:""}</div><span class="badge ${cl}">${lab}</span></div><button class="done-btn ${p.done?"done":""}" data-done="${p.id}">✓</button><button class="delete-btn" data-delete="${p.id}">×</button></div>`
}
function renderProducts(){
  const arr=products.filter(matches).sort((a,b)=>a.expiry.localeCompare(b.expiry));
  $("productList").innerHTML=arr.length?arr.map(productHTML).join(""):`<div class="panel" style="text-align:center;color:#74808a">Aucun produit.</div>`
}
function dailyProducts(){
  const a=products.filter(p=>!p.done);
  if(dailyMode==="today")return a.filter(p=>status(p)[1]==="red");
  return a.filter(p=>status(p)[1]==="amber")
}
function renderDaily(){
  const arr=dailyProducts();
  $("dailyTitle").textContent=dailyMode==="today"?"À retirer aujourd'hui":"À surveiller demain";
  $("dailyCount").textContent=`${qty(arr)} produits`;
  const d=dailyMode==="today"?selectedDate:addDays(selectedDate,1);
  $("dailyDate").textContent="📅 "+new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(d);
  $("dailyList").innerHTML=arr.length?arr.map(productHTML).join(""):`<div class="panel" style="text-align:center;color:#74808a">Rien à retirer 🎉</div>`
}
function renderStats(){
  const w=products.filter(p=>{const d=new Date(p.expiry+"T00:00:00");return d>=monday(selectedDate)&&d<=sunday(selectedDate)});
  $("weekLine").textContent=`Semaine du ${fmt(monday(selectedDate))} au ${fmt(sunday(selectedDate))}`;
  $("removedStat").textContent=qty(w.filter(p=>p.done));$("pendingStat").textContent=qty(w.filter(p=>!p.done));
  $("lossStat").textContent=(qty(w.filter(p=>p.done))*0.65).toFixed(2).replace(".",",")+" €";
  const map={};w.forEach(p=>map[p.department]=(map[p.department]||0)+(+p.quantity||0));const max=Math.max(1,...Object.values(map));
  $("departmentStats").innerHTML=Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="bar-row"><div class="bar-label"><span>${esc(k)}</span><span>${v}</span></div><div class="bar"><i style="width:${v/max*100}%"></i></div></div>`).join("")||"<p>Aucune donnée.</p>";
  const hist=products.filter(p=>p.done&&p.doneAt).sort((a,b)=>b.doneAt.localeCompare(a.doneAt)).slice(0,7);
  $("history").innerHTML=hist.length?hist.map(p=>`<div class="history-row"><span>${fmt(p.doneAt)}</span><b>${esc(p.name)} ×${p.quantity}</b></div>`).join(""):"<p style='color:#74808a'>Aucun retrait.</p>"
}
async function startCamera(){
  $("cameraPlaceholder").style.display="flex";
  try{
    if(!window.ZXing) throw new Error("Scanner indisponible");
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.ITF,
      ZXing.BarcodeFormat.CODABAR
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    codeReader = new ZXing.BrowserMultiFormatReader(hints, 300);
    scannerRunning = true;
    $("cameraPlaceholder").style.display="none";

    await codeReader.decodeFromConstraints(
      {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      },
      "reader",
      (result, err) => {
        if(result && scannerRunning){
          const code = result.getText();
          $("barcode").value = code;
          toast("Code détecté : " + code);
          stopCamera();
          showView("addView");
        }
      }
    );
  }catch(e){
    scannerRunning=false;
    $("cameraPlaceholder").style.display="flex";
    toast("Impossible d'ouvrir le scanner. Vérifie l'autorisation caméra.");
  }
}
function stopCamera(){
  scannerRunning=false;
  try{
    if(codeReader) codeReader.reset();
  }catch(e){}
  codeReader=null;
  const v=$("reader");
  if(v && v.srcObject){
    try{ v.srcObject.getTracks().forEach(t=>t.stop()); }catch(e){}
    v.srcObject=null;
  }
}
function handleListClick(e){
  const d=e.target.closest("[data-done]"),x=e.target.closest("[data-delete]");
  if(d){const p=products.find(p=>p.id===d.dataset.done);p.done=!p.done;p.doneAt=p.done?new Date().toISOString():null;save();render()}
  if(x){products=products.filter(p=>p.id!==x.dataset.delete);save();render();toast("Produit supprimé")}
}
if(localStorage.getItem(STARTED)){$("splash").classList.add("hidden");$("app").classList.remove("hidden")}
$("startBtn").onclick=()=>{localStorage.setItem(STARTED,"1");$("splash").classList.add("hidden");$("app").classList.remove("hidden")};
$$("[data-view]").forEach(b=>b.onclick=()=>showView(b.dataset.view));
$("plusBtn").onclick=()=>showView("addView");$("manualBtn").onclick=()=>showView("addView");$("manualMode").onclick=()=>showView("addView");$("scanMode").onclick=()=>showView("scanView");
$$("[data-open]").forEach(b=>b.onclick=()=>{const m=b.dataset.open;if(m==="week"){activeFilter="week";$$(".filter").forEach(x=>x.classList.toggle("active",x.dataset.filter==="week"));showView("productsView");renderProducts()}else{dailyMode=m;renderDaily();showView("dailyView")}});
$("seeAll").onclick=()=>{activeFilter="all";showView("productsView");renderProducts()};
$$(".filter").forEach(b=>b.onclick=()=>{activeFilter=b.dataset.filter;$$(".filter").forEach(x=>x.classList.toggle("active",x===b));renderProducts()});
$("search").oninput=renderProducts;
$("qtyMinus").onclick=()=>$("quantity").value=Math.max(1,(+$("quantity").value||1)-1);
$("qtyPlus").onclick=()=>$("quantity").value=(+$("quantity").value||1)+1;
$("productForm").onsubmit=e=>{e.preventDefault();products.push({id:crypto.randomUUID?crypto.randomUUID():Date.now().toString(),name:$("name").value.trim(),quantity:+$("quantity").value,expiry:$("expiry").value,department:$("department").value,barcode:$("barcode").value.trim(),note:$("note").value.trim(),done:false,createdAt:new Date().toISOString()});save();e.target.reset();$("quantity").value=1;toast("Produit ajouté ✓");showView("productsView");render()};
$("productList").onclick=handleListClick;$("dailyList").onclick=handleListClick;
$("doneAll").onclick=()=>{dailyProducts().forEach(p=>{p.done=true;p.doneAt=new Date().toISOString()});save();render();toast("Tout est retiré ✓")};
$("storeBtn").onclick=$("storeSettings").onclick=()=>{$("storeInput").value=storeName();$("storeDialog").showModal()};
$("cancelStore").onclick=()=>$("storeDialog").close();
$("saveStore").onclick=()=>{const v=$("storeInput").value.trim();if(v){localStorage.setItem(STORE,v);updateStore();$("storeDialog").close();toast("Magasin enregistré")} };
$("menuBtn").onclick=()=>showView("settingsView");$("teamBtn").onclick=()=>toast("Comptes employés : prochaine étape");
$("exportBtn").onclick=()=>{const blob=new Blob([JSON.stringify({store:storeName(),products},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="frais-proxi-sauvegarde.json";a.click();URL.revokeObjectURL(a.href)};
window.addEventListener("beforeunload",stopCamera);updateStore();render();