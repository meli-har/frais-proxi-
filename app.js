const KEY="fraisProxiProducts";
let products=JSON.parse(localStorage.getItem(KEY)||"[]");
let selectedDate=new Date(); selectedDate.setHours(0,0,0,0);
let activeFilter="all";

const $=id=>document.getElementById(id);
const iso=d=>{const x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,10)};
const today=()=>iso(selectedDate);
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const fmt=d=>new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(d));
const same=(a,b)=>iso(a)===iso(b);
function save(){localStorage.setItem(KEY,JSON.stringify(products))}
function status(p){
  if(p.done)return ["Retiré","success"];
  const d=new Date(p.expiry+"T00:00:00"), t=new Date(today()+"T00:00:00");
  const diff=Math.round((d-t)/86400000);
  if(diff<=0)return ["À retirer aujourd'hui","danger"];
  if(diff===1)return ["Demain","warning"];
  if(diff<=7)return ["Cette semaine","success"];
  return ["À venir",""];
}
function icon(dep){return ({Frais:"🥬",Crèmerie:"🥛",Charcuterie:"🥩",Traiteur:"🍽️",Épicerie:"🛒",Boucherie:"🥩",Poissonnerie:"🐟",Autre:"📦"})[dep]||"📦"}
function render(){
  $("currentDate").textContent=new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"numeric",month:"long"}).format(selectedDate);
  $("currentWeek").textContent="Semaine du "+fmt(startOfWeek(selectedDate))+" au "+fmt(endOfWeek(selectedDate));
  const active=products.filter(p=>!p.done);
  $("todayCount").textContent=active.filter(p=>status(p)[1]==="danger").reduce((n,p)=>n+p.quantity,0);
  $("tomorrowCount").textContent=active.filter(p=>status(p)[1]==="warning").reduce((n,p)=>n+p.quantity,0);
  $("weekCount").textContent=active.filter(p=>{const d=new Date(p.expiry);return d>=startOfWeek(selectedDate)&&d<=endOfWeek(selectedDate)}).reduce((n,p)=>n+p.quantity,0);
  renderUpcoming(); renderProducts(); renderStats();
}
function startOfWeek(d){const x=new Date(d), day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);x.setHours(0,0,0,0);return x}
function endOfWeek(d){const x=startOfWeek(d);x.setDate(x.getDate()+6);return x}
function renderUpcoming(){
  const s=startOfWeek(selectedDate), labels=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
  $("upcoming").innerHTML=labels.slice(0,4).map((l,i)=>{const d=addDays(s,i), n=products.filter(p=>!p.done&&same(p.expiry,d)).reduce((a,p)=>a+p.quantity,0);return `<div class="day"><strong>${l}</strong><small>${d.getDate()}</small><b>${n}</b></div>`}).join("");
}
function matches(p){
  if($("search").value.trim()&&!p.name.toLowerCase().includes($("search").value.trim().toLowerCase()))return false;
  if(activeFilter==="all")return true;
  const s=status(p)[1];
  if(activeFilter==="today")return s==="danger";
  if(activeFilter==="tomorrow")return s==="warning";
  if(activeFilter==="week"){const d=new Date(p.expiry),s0=startOfWeek(selectedDate),e=endOfWeek(selectedDate);return d>=s0&&d<=e}
  return true;
}
function renderProducts(){
  const arr=products.filter(matches).sort((a,b)=>a.expiry.localeCompare(b.expiry));
  $("productList").innerHTML=arr.length?arr.map(p=>{const [label,cl]=status(p);return `<div class="product">
    <div class="product-icon">${icon(p.department)}</div><div class="product-main"><strong>${esc(p.name)} × ${p.quantity}</strong>
    <div class="meta">${esc(p.department)} · DLC ${fmt(p.expiry)}${p.note?" · "+esc(p.note):""}</div>
    <span class="badge ${cl}">${label}</span></div>
    <button class="check ${p.done?"done":""}" data-done="${p.id}">${p.done?"✓":"✓"}</button>
    <button class="delete" data-delete="${p.id}">×</button></div>`}).join(""):`<div class="card" style="text-align:center;color:#687681">Aucun produit trouvé.</div>`;
}
function renderStats(){
  const week=products.filter(p=>{const d=new Date(p.expiry),s=startOfWeek(selectedDate),e=endOfWeek(selectedDate);return d>=s&&d<=e});
  $("statTotal").textContent=week.reduce((n,p)=>n+p.quantity,0);
  $("statToday").textContent=week.filter(p=>!p.done&&status(p)[1]==="danger").reduce((n,p)=>n+p.quantity,0);
  $("statDone").textContent=week.filter(p=>p.done).reduce((n,p)=>n+p.quantity,0);
  $("statPending").textContent=week.filter(p=>!p.done).reduce((n,p)=>n+p.quantity,0);
  const map={};week.forEach(p=>map[p.department]=(map[p.department]||0)+p.quantity);
  const max=Math.max(1,...Object.values(map));
  $("departmentStats").innerHTML=Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="bar-row"><div class="bar-label"><span>${esc(k)}</span><span>${v}</span></div><div class="bar"><i style="width:${v/max*100}%"></i></div></div>`).join("")||"<p class='muted'>Pas encore de données.</p>";
}
function showView(id){document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));$(id).classList.add("active");document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===id));window.scrollTo(0,0)}
function toast(t){$("toast").textContent=t;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),1800)}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

document.querySelectorAll(".nav-btn").forEach(b=>b.onclick=()=>showView(b.dataset.view));
$("navAdd").onclick=()=>showView("addView");
$("addFromHome").onclick=$("addFromProducts").onclick=()=>showView("addView");
$("seeAll").onclick=()=>{activeFilter="all";document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.filter==="all"));showView("productsView");renderProducts()};
$("prevDay").onclick=()=>{selectedDate=addDays(selectedDate,-1);render()};
$("nextDay").onclick=()=>{selectedDate=addDays(selectedDate,1);render()};
document.querySelectorAll(".summary").forEach(b=>b.onclick=()=>{activeFilter=b.dataset.filter;showView("productsView");document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.filter===activeFilter));renderProducts()});
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{activeFilter=b.dataset.filter;document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));renderProducts()});
$("search").oninput=renderProducts;
$("productForm").onsubmit=e=>{
 e.preventDefault();
 const p={id:crypto.randomUUID(),name:$("name").value.trim(),quantity:+$("quantity").value,expiry:$("expiry").value,department:$("department").value,note:$("note").value.trim(),done:false};
 products.push(p);save();e.target.reset();$("quantity").value=1;toast("Produit ajouté ✓");showView("productsView");render();
};
$("productList").onclick=e=>{
 const done=e.target.closest("[data-done]"),del=e.target.closest("[data-delete]");
 if(done){const p=products.find(x=>x.id===done.dataset.done);p.done=!p.done;save();render();toast(p.done?"Produit marqué comme retiré":"Produit remis en attente")}
 if(del){products=products.filter(x=>x.id!==del.dataset.delete);save();render();toast("Produit supprimé")}
};
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();window.installPrompt=e;$("installBtn").hidden=false});
$("installBtn").onclick=async()=>{if(window.installPrompt){window.installPrompt.prompt();window.installPrompt=null}};
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js"));
render();
