// ==========================================================
// Anwesenheits Check – App-Logik
// Alle Daten werden ausschließlich in Firestore gespeichert
// (Sammlung "users", Dokument = Nutzer-ID). Es wird nichts
// Anwesenheitsrelevantes im Browser (localStorage) abgelegt.
// ==========================================================

let currentUser = null;
let db_data = { groups: [] };
let saveTimeout = null;

// ---------- Auth-Guard ----------
auth.onAuthStateChanged(user => {
  if(!user){
    window.location.href = "login.html";
    return;
  }
  currentUser = user;
  loadData();
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  if(confirm("Wirklich abmelden?")) auth.signOut().then(()=> window.location.href = "login.html");
});

// ---------- Firestore laden / speichern ----------
function loadData(){
  db.collection("users").doc(currentUser.uid).get().then(doc => {
    if(doc.exists && doc.data().data){
      db_data = doc.data().data;
    } else {
      db_data = { groups: [] };
      db.collection("users").doc(currentUser.uid).set({ data: db_data }, { merge: true });
    }
    render();
  }).catch(err => {
    document.getElementById("app").innerHTML = `<div class="empty">Fehler beim Laden: ${err.message}</div>`;
  });
}

function persist(){
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    db.collection("users").doc(currentUser.uid).set({ data: db_data }, { merge: true });
  }, 400); // kurze Verzögerung, um nicht bei jedem Klick sofort zu schreiben
}

// ---------- Navigation ----------
let nav = { view: "groups", groupId: null, tab: "termine", terminId: null };
function uid(){ return Date.now() + Math.floor(Math.random()*1000); }
function goto(view, extra={}){ nav = { view, groupId: nav.groupId, tab: nav.tab, terminId: nav.terminId, ...extra }; render(); }
function getGroup(id){ return db_data.groups.find(g=>g.id===id); }
function getTermin(g, id){ return g.termine.find(t=>t.id===id); }

// ---------- Aktionen ----------
function addGroup(name){ db_data.groups.push({ id: uid(), name, personen: [], termine: [] }); persist(); render(); }
function deleteGroup(id){ db_data.groups = db_data.groups.filter(g=>g.id!==id); persist(); goto("groups"); }
function addPerson(g, name){ g.personen.push({ id: uid(), name }); persist(); render(); }
function deletePerson(g, id){
  g.personen = g.personen.filter(p=>p.id!==id);
  g.termine.forEach(t=>{ delete t.status[id]; delete t.notizen[id]; });
  persist(); render();
}
function addTermin(g, datum, bezeichnung){
  g.termine.push({ id: uid(), datum, bezeichnung: bezeichnung || "Termin", status: {}, notizen: {} });
  g.termine.sort((a,b)=> a.datum < b.datum ? 1 : -1);
  persist(); render();
}
function deleteTermin(g, id){ g.termine = g.termine.filter(t=>t.id!==id); persist(); goto("group", { tab: "termine" }); }
function setStatus(t, personId, status){ t.status[personId] = status; persist(); render(); }
function setNote(t, personId, text){ t.notizen[personId] = text; persist(); }
function rate(g, personId){
  let total=0, anwesend=0;
  g.termine.forEach(t=>{ if(t.status[personId]!==undefined){ total++; if(t.status[personId]==="anwesend") anwesend++; } });
  return total ? Math.round(anwesend/total*1000)/10 : 0;
}
function exportCSV(g){
  let rows=[["Datum","Termin","Person","Status","Notiz"]];
  g.termine.forEach(t=>{
    g.personen.forEach(p=>{
      rows.push([t.datum, t.bezeichnung, p.name, t.status[p.id]||"-", t.notizen[p.id]||""]);
    });
  });
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${g.name}_export.csv`;
  a.click();
}

// ---------- Modals ----------
function showModal(html){
  const bg = document.createElement("div");
  bg.className = "modal-bg"; bg.id = "modalBg";
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener("click", e=>{ if(e.target===bg) closeModal(); });
  document.body.appendChild(bg);
}
function closeModal(){ document.getElementById("modalBg")?.remove(); }

function modalNewGroup(){
  showModal(`<h3>Neue Gruppe</h3>
    <input id="mGroupName" type="text" placeholder="Gruppenname (z. B. Fussball U12)">
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="submitGroup()">Erstellen</button>
    </div>`);
  setTimeout(()=>document.getElementById("mGroupName").focus(),50);
}
function submitGroup(){ const n=document.getElementById("mGroupName").value.trim(); if(!n)return; addGroup(n); closeModal(); }

function modalNewPerson(){
  showModal(`<h3>Neue Person</h3>
    <input id="mPersonName" type="text" placeholder="Name">
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="submitPerson()">Hinzufügen</button>
    </div>`);
  setTimeout(()=>document.getElementById("mPersonName").focus(),50);
}
function submitPerson(){ const n=document.getElementById("mPersonName").value.trim(); if(!n)return; addPerson(getGroup(nav.groupId), n); closeModal(); }

function modalNewTermin(){
  const today = new Date().toISOString().slice(0,10);
  showModal(`<h3>Neuer Termin</h3>
    <input id="mTerminDatum" type="date" value="${today}">
    <input id="mTerminName" type="text" placeholder="Bezeichnung (z. B. Training)">
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="submitTermin()">Erstellen</button>
    </div>`);
}
function submitTermin(){
  const datum = document.getElementById("mTerminDatum").value;
  const name = document.getElementById("mTerminName").value.trim();
  if(!datum) return;
  addTermin(getGroup(nav.groupId), datum, name); closeModal();
}

// ---------- Rendering ----------
function render(){
  const app = document.getElementById("app");
  const back = document.getElementById("backBtn");
  const exportBtn = document.getElementById("exportBtn");
  const title = document.getElementById("pageTitle");
  const fab = document.getElementById("fabBtn");
  back.style.visibility = nav.view==="groups" ? "hidden" : "visible";
  exportBtn.style.visibility = "hidden";
  fab.style.display = "block";

  if(nav.view==="groups"){
    title.textContent = "Anwesenheits Check";
    fab.onclick = modalNewGroup;
    app.innerHTML = db_data.groups.length ? db_data.groups.map(g=>`
      <div class="card" onclick="goto('group',{groupId:${g.id},tab:'termine'})">
        <div class="info"><b>${g.name}</b><span>${g.personen.length} Personen · ${g.termine.length} Termine</span></div>
        <span class="badge">›</span>
      </div>`).join("") : `<div class="empty">Noch keine Gruppen.<br>Tippe auf + um eine Gruppe anzulegen.</div>`;
    return;
  }

  const g = getGroup(nav.groupId);
  if(!g){ nav.view="groups"; return render(); }

  if(nav.view==="group"){
    title.textContent = g.name;
    exportBtn.style.visibility = "visible";
    exportBtn.onclick = ()=>exportCSV(g);
    fab.onclick = nav.tab==="termine" ? modalNewTermin : (nav.tab==="personen" ? modalNewPerson : null);
    fab.style.display = nav.tab==="statistik" ? "none" : "block";

    let body = "";
    if(nav.tab==="termine"){
      body = g.termine.length ? g.termine.map(t=>`
        <div class="card" onclick="goto('termin',{terminId:${t.id}})">
          <div class="info"><b>${t.bezeichnung}</b><span>${t.datum}</span></div>
          <span class="badge">${Object.keys(t.status).length}/${g.personen.length}</span>
        </div>`).join("") : `<div class="empty">Noch keine Termine.<br>Tippe auf + für einen neuen Termin.</div>`;
    } else if(nav.tab==="personen"){
      body = g.personen.length ? g.personen.map(p=>`
        <div class="row">
          <div class="name">${p.name}</div>
          <span class="del" onclick="deletePerson(getGroup(${g.id}),${p.id})">Entfernen</span>
        </div>`).join("") : `<div class="empty">Noch keine Personen.<br>Tippe auf + um jemanden hinzuzufügen.</div>`;
    } else if(nav.tab==="statistik"){
      body = g.personen.length ? g.personen.map(p=>{
        const r = rate(g, p.id);
        return `<div class="row" style="display:block;">
          <div class="name">${p.name}</div>
          <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${r}%"></div></div>
          <small style="color:var(--muted)">${r}% Anwesenheit</small>
        </div>`;
      }).join("") : `<div class="empty">Keine Daten vorhanden.</div>`;
    }

    app.innerHTML = `
      <div class="tabs">
        <div class="tab ${nav.tab==='termine'?'active':''}" onclick="goto('group',{tab:'termine'})">Termine</div>
        <div class="tab ${nav.tab==='personen'?'active':''}" onclick="goto('group',{tab:'personen'})">Personen</div>
        <div class="tab ${nav.tab==='statistik'?'active':''}" onclick="goto('group',{tab:'statistik'})">Statistik</div>
      </div>
      ${body}
      ${nav.tab==='termine' ? `<div class="empty" style="padding-top:6px;"><span class="del" style="color:var(--muted)" onclick="if(confirm('Gruppe wirklich löschen?'))deleteGroup(${g.id})">Gruppe löschen</span></div>` : ""}
    `;
    return;
  }

  if(nav.view==="termin"){
    const t = getTermin(g, nav.terminId);
    if(!t){ return goto("group",{tab:"termine"}); }
    title.textContent = t.bezeichnung + " · " + t.datum;
    fab.style.display = "none";

    app.innerHTML = (g.personen.length ? g.personen.map(p=>{
      const st = t.status[p.id];
      const cls = s => st===s ? `on-${s}` : "";
      return `<div class="row" style="display:block;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div class="name">${p.name}</div>
          <div class="status-btns">
            <button class="${cls('anwesend')}" onclick="setStatus(getTermin(getGroup(${g.id}),${t.id}),${p.id},'anwesend')">Anwesend</button>
            <button class="${cls('entschuldigt')}" onclick="setStatus(getTermin(getGroup(${g.id}),${t.id}),${p.id},'entschuldigt')">Entschuldigt</button>
            <button class="${cls('abwesend')}" onclick="setStatus(getTermin(getGroup(${g.id}),${t.id}),${p.id},'abwesend')">Abwesend</button>
          </div>
        </div>
        <input class="note-input ${t.notizen[p.id]?'show':''}" placeholder="Notiz..." value="${t.notizen[p.id]||''}"
          onfocus="this.classList.add('show')"
          onchange="setNote(getTermin(getGroup(${g.id}),${t.id}),${p.id}, this.value)">
      </div>`;
    }).join("") : `<div class="empty">Diese Gruppe hat noch keine Personen.</div>`)
    + `<div class="empty" style="padding-top:10px;"><span class="del" onclick="if(confirm('Termin wirklich löschen?'))deleteTermin(getGroup(${g.id}),${t.id})">Termin löschen</span></div>`;
    return;
  }
}

document.getElementById("backBtn").addEventListener("click", ()=>{
  if(nav.view==="termin") goto("group",{tab:"termine"});
  else if(nav.view==="group") goto("groups");
});
