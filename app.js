// ==========================================================
// Anwesenheits Check – App-Logik (Version 3)
// ==========================================================

let currentUser = null;
let currentUserData = null;
let groupsOwner = [], groupsMember = [];
let unsubOwner=null, unsubMember=null, unsubGroup=null, unsubLogs=null;
let heartbeatTimer=null, countdownTimer=null;
let currentGroup = null;
let iHoldLock = false;
let autoRefreshEnabled = true;
let pendingRenderFlag = false;
let refreshCountdownVal = 60;

let nav = { view: "groups", groupId: null, tab: "termine", terminId: null };
let groupsFilter = { search: "", owner: "all" };

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function nowMs(){ return Date.now(); }
function isTypingActive(){
  const el = document.activeElement;
  return !!(el && (el.tagName==="INPUT" || el.tagName==="TEXTAREA"));
}
function genCode(){ return String(Math.floor(100000 + Math.random()*900000)); }

// ---------- Auth-Guard ----------
auth.onAuthStateChanged(async user => {
  if(!user){
    cleanupListeners();
    window.location.href = "login.html";
    return;
  }
  currentUser = user;
  try{
    await ensureUserDoc(user);
    await processPendingInvites(user);
  }catch(e){ console.error(e); }
  applySettings();
  loadUserGroups();
  startCountdownLoop();
  render();
});

async function ensureUserDoc(user){
  const ref = db.collection("users").doc(user.uid);
  const snap = await ref.get();
  if(!snap.exists){
    await ref.set({
      name: user.displayName || (user.email ? user.email.split("@")[0] : "Nutzer"),
      email: (user.email||"").toLowerCase(),
      emailVerified: false,
      settings: { autoRefresh: true, darkMode: false },
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  currentUserData = (await ref.get()).data();
}

async function processPendingInvites(user){
  if(!user.email) return;
  const email = user.email.toLowerCase();
  const inviteRef = db.collection("invites").doc(email);
  const snap = await inviteRef.get();
  if(!snap.exists) return;
  const groupIds = snap.data().groupIds || [];
  for(const gid of groupIds){
    try{
      await db.collection("groups").doc(gid).update({
        members: firebase.firestore.FieldValue.arrayUnion(user.uid),
        [`memberInfo.${user.uid}`]: { email, name: user.displayName || email, addedAt: nowMs() },
        [`pendingInvites.${email}`]: firebase.firestore.FieldValue.delete()
      });
      writeLog(gid, "mitarbeiter_beigetreten", `${user.displayName||email} ist der Gruppe beigetreten`);
    }catch(e){ console.error("Einladung konnte nicht verarbeitet werden:", e); }
  }
  await inviteRef.delete().catch(()=>{});
}

function cleanupListeners(){
  if(unsubOwner) unsubOwner();
  if(unsubMember) unsubMember();
  if(unsubGroup) unsubGroup();
  if(unsubLogs) unsubLogs();
  if(heartbeatTimer) clearInterval(heartbeatTimer);
  if(countdownTimer) clearInterval(countdownTimer);
}
window.addEventListener("beforeunload", () => { releaseLock(true); });

// ---------- Einstellungen (Auto-Refresh / Dark Mode) ----------
function applySettings(){
  const s = currentUserData?.settings || {};
  autoRefreshEnabled = s.autoRefresh !== false;
  document.body.classList.toggle("dark", s.darkMode === true);
  const toggle = document.getElementById("refreshToggle");
  if(toggle) toggle.checked = autoRefreshEnabled;
}
async function saveSetting(key, value){
  try{ await db.collection("users").doc(currentUser.uid).update({ [`settings.${key}`]: value }); }
  catch(e){ toast("Fehler beim Speichern der Einstellung: " + e.message); }
}
document.getElementById("refreshToggle")?.addEventListener("change", (e)=>{
  autoRefreshEnabled = e.target.checked;
  saveSetting("autoRefresh", autoRefreshEnabled);
  if(autoRefreshEnabled) applyPending();
  updateCountdownDisplay();
});
function toggleDarkMode(on){
  document.body.classList.toggle("dark", on);
  saveSetting("darkMode", on);
  if(currentUserData) currentUserData.settings = { ...(currentUserData.settings||{}), darkMode: on };
}

// ---------- Live-Rendering / Refresh-Steuerung ----------
function scheduleRender(){
  pendingRenderFlag = true;
  if(!autoRefreshEnabled) { render_gate_only(); return; }
  if(isTypingActive()) return;
  applyPending();
}
function applyPending(){ pendingRenderFlag = false; render(); }
// Aktualisiert nur unkritische UI-Teile (z. B. Badges), ohne offene Eingaben zu stören,
// wenn Auto-Aktualisierung deaktiviert ist.
function render_gate_only(){ /* bewusst kein voller Re-Render, siehe applyPending() */ }

function startCountdownLoop(){
  clearInterval(countdownTimer);
  refreshCountdownVal = 60;
  updateCountdownDisplay();
  countdownTimer = setInterval(()=>{
    if(!autoRefreshEnabled){ updateCountdownDisplay(); return; }
    refreshCountdownVal--;
    if(refreshCountdownVal <= 0){
      refreshCountdownVal = 60;
      if(pendingRenderFlag && !isTypingActive()) applyPending();
    }
    updateCountdownDisplay();
  }, 1000);
}
function updateCountdownDisplay(){
  const el = document.getElementById("refreshCountdown");
  if(!el) return;
  el.textContent = autoRefreshEnabled ? (refreshCountdownVal + " s") : "aus";
}
function manualSave(){
  if(isTypingActive()) document.activeElement.blur();
  applyPending();
  toast("✓ Gespeichert");
}
document.getElementById("saveBtn")?.addEventListener("click", manualSave);

// ---------- Logout ----------
document.getElementById("logoutBtn").addEventListener("click", () => {
  showConfirm("Möchtest du dich wirklich abmelden?", "Abmelden", async () => {
    await releaseLock();
    cleanupListeners();
    try{ await auth.signOut(); }catch(e){ console.error(e); }
    window.location.href = "login.html";
  });
});
document.getElementById("accountBtn")?.addEventListener("click", () => goto("konto"));

// ---------- Live-Gruppenliste ----------
function loadUserGroups(){
  if(unsubOwner) unsubOwner();
  if(unsubMember) unsubMember();
  unsubOwner = db.collection("groups").where("ownerUid","==",currentUser.uid)
    .onSnapshot(snap => { groupsOwner = snap.docs.map(d=>({id:d.id, ...d.data()})); if(nav.view==="groups") scheduleRender(); },
      err => toast("Fehler beim Laden: " + err.message));
  unsubMember = db.collection("groups").where("members","array-contains",currentUser.uid)
    .onSnapshot(snap => { groupsMember = snap.docs.map(d=>({id:d.id, ...d.data()})); if(nav.view==="groups") scheduleRender(); },
      err => toast("Fehler beim Laden: " + err.message));
}
function allMyGroups(){
  const map = new Map();
  [...groupsOwner, ...groupsMember].forEach(g => map.set(g.id, g));
  return [...map.values()].sort((a,b)=> (a.name||"").localeCompare(b.name||""));
}
function filteredGroups(){
  let list = allMyGroups();
  if(groupsFilter.owner==="own") list = list.filter(g=>isOwner(g));
  if(groupsFilter.owner==="shared") list = list.filter(g=>!isOwner(g));
  if(groupsFilter.search.trim()) list = list.filter(g=> (g.name||"").toLowerCase().includes(groupsFilter.search.trim().toLowerCase()));
  return list;
}

// ---------- Gruppe öffnen / schließen + Live-Sperre ----------
async function openGroup(groupId){ goto("group", { groupId, tab: "termine" }); }

function subscribeGroup(groupId){
  if(unsubGroup) unsubGroup();
  currentGroup = null;
  unsubGroup = db.collection("groups").doc(groupId).onSnapshot(async doc => {
    if(!doc.exists){ currentGroup = null; goto("groups"); return; }
    currentGroup = { id: doc.id, ...doc.data() };
    await tryAcquireLock(groupId);
    scheduleRender();
  }, err => toast("Fehler: " + err.message));
}
async function tryAcquireLock(groupId){
  const ref = db.collection("groups").doc(groupId);
  try{
    await db.runTransaction(async t => {
      const doc = await t.get(ref);
      const data = doc.data();
      const lock = data.editLock;
      const stale = !lock || !lock.ts || (nowMs() - lock.ts) > 25000;
      if(!lock || lock.uid === currentUser.uid || stale){
        t.update(ref, { editLock: { uid: currentUser.uid, name: currentUserData?.name || currentUser.email, ts: nowMs() } });
        iHoldLock = true;
      } else { iHoldLock = false; }
    });
  }catch(e){
    console.error("Sperre konnte nicht aktualisiert werden:", e);
    // iHoldLock bewusst NICHT hart auf false setzen – der nächste Heartbeat-Tick
    // versucht es automatisch erneut, statt Buttons dauerhaft zu verstecken.
  }
  startHeartbeat(groupId);
}
function startHeartbeat(groupId){
  if(heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    if(!currentGroup || currentGroup.id !== groupId) return;
    if(iHoldLock){
      try{ await db.collection("groups").doc(groupId).update({ "editLock.ts": nowMs() }); }
      catch(e){ console.error(e); }
    } else {
      // Sperre evtl. inzwischen frei geworden oder abgelaufen -> automatisch neu versuchen
      await tryAcquireLock(groupId);
      scheduleRender();
    }
  }, 8000);
}
async function releaseLock(){
  if(!iHoldLock || !currentGroup) return;
  iHoldLock = false;
  try{ await db.collection("groups").doc(currentGroup.id).update({ editLock: null }); }catch(e){}
}
function closeGroup(){
  releaseLock();
  if(unsubGroup) unsubGroup(); unsubGroup = null;
  if(unsubLogs) unsubLogs(); unsubLogs = null;
  currentGroup = null;
  if(heartbeatTimer) clearInterval(heartbeatTimer);
}
function isEditable(){ return currentGroup && iHoldLock; }
function isOwner(g){ return g && currentUser && g.ownerUid === currentUser.uid; }

// ---------- Navigation ----------
function goto(view, extra={}){
  if(!currentUserData?.emailVerified && view!=="verify" && view!=="konto"){
    view = "verify"; extra = {};
  }
  if(nav.view==="group" && view!=="group" && view!=="termin") closeGroup();
  nav = { view, groupId: nav.groupId, tab: nav.tab, terminId: nav.terminId, ...extra };
  if(view==="group" && (!currentGroup || currentGroup.id!==nav.groupId)) subscribeGroup(nav.groupId);
  if(view==="group" && nav.tab==="logs") subscribeLogs(nav.groupId);
  else if(unsubLogs){ unsubLogs(); unsubLogs=null; }
  render();
}
function getTermin(g, id){ return (g.termine||[]).find(t=>t.id===id); }

// ---------- Logs ----------
async function writeLog(groupId, action, details){
  try{
    await db.collection("groups").doc(groupId).collection("logs").add({
      uid: currentUser.uid, name: currentUserData?.name || currentUser.email,
      action, details, ts: firebase.firestore.FieldValue.serverTimestamp()
    });
  }catch(e){ console.error("Log-Fehler:", e); }
}
let currentLogs = [];
function subscribeLogs(groupId){
  if(unsubLogs) unsubLogs();
  currentLogs = [];
  cleanupOldLogs(groupId);
  unsubLogs = db.collection("groups").doc(groupId).collection("logs")
    .orderBy("ts","desc").limit(50)
    .onSnapshot(snap => { currentLogs = snap.docs.map(d=>({id:d.id, ...d.data()})); scheduleRender(); },
      err => toast("Fehler beim Laden der Logs: " + err.message));
}
// Löscht Logs älter als 30 Tage. Läuft nur, wenn der Ersteller den Logs-Tab öffnet
// (rein clientseitig – siehe README für eine echte Cloud-Function-Lösung, die auch
// läuft, ohne dass jemand die App geöffnet hat).
async function cleanupOldLogs(groupId){
  const cutoff = nowMs() - 30*24*60*60*1000;
  try{
    const oldLogs = await db.collection("groups").doc(groupId).collection("logs")
      .where("ts","<", new Date(cutoff)).limit(200).get();
    if(oldLogs.empty) return;
    const batch = db.batch();
    oldLogs.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }catch(e){ console.error("Log-Bereinigung fehlgeschlagen:", e); }
}

// ---------- Toast ----------
let toastTimeout=null;
function toast(msg){
  let el = document.getElementById("toastEl");
  if(!el){ el = document.createElement("div"); el.id="toastEl"; el.className="toast"; document.body.appendChild(el); }
  el.textContent = msg; el.style.display = "block";
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(()=> el.style.display="none", 3200);
}
function showConfirm(message, actionLabel, onConfirm){
  const bg = document.createElement("div");
  bg.className = "modal-bg confirm-modal"; bg.id = "confirmBg";
  bg.innerHTML = `<div class="modal">
    <h3>Bitte bestätigen</h3>
    <p style="color:var(--muted);font-size:14px;margin:-6px 0 16px;">${message}</p>
    <div class="modal-btns">
      <button class="btn btn-secondary" id="confirmCancel">Abbrechen</button>
      <button class="btn btn-primary" id="confirmOk" style="background:var(--abwesend)">${actionLabel}</button>
    </div>
  </div>`;
  document.body.appendChild(bg);
  document.getElementById("confirmCancel").onclick = ()=> bg.remove();
  document.getElementById("confirmOk").onclick = ()=> { bg.remove(); onConfirm(); };
}

// ---------- Aktionen: Gruppen ----------
async function addGroup(name){
  try{
    await db.collection("groups").add({
      name, ownerUid: currentUser.uid, ownerEmail: currentUser.email,
      members: [currentUser.uid],
      memberInfo: { [currentUser.uid]: { email: currentUser.email, name: currentUserData?.name || currentUser.email, addedAt: nowMs(), role: "owner" } },
      pendingInvites: {}, personen: [], termine: [], editLock: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast("Gruppe erstellt");
  }catch(e){ toast("Fehler: " + e.message); }
}
function deleteGroup(g){
  showConfirm(`Gruppe "${g.name}" inkl. aller Termine und Personen unwiderruflich löschen?`, "Löschen", async ()=>{
    try{ await db.collection("groups").doc(g.id).delete(); goto("groups"); toast("Gruppe gelöscht"); }
    catch(e){ toast("Fehler: " + e.message); }
  });
}

// ---------- Aktionen: Personen ----------
async function addPerson(g, person){
  if(!isEditable()) return toast("Gruppe wird gerade von jemand anderem bearbeitet.");
  const personen = [...(g.personen||[]), { id: uid(), ...person }];
  try{ await db.collection("groups").doc(g.id).update({ personen });
    writeLog(g.id, "person_hinzugefuegt", `${person.name} wurde hinzugefügt`); }
  catch(e){ toast("Fehler: " + e.message); }
}
async function updatePerson(g, personId, updates){
  if(!isEditable()) return toast("Gruppe wird gerade von jemand anderem bearbeitet.");
  const personen = (g.personen||[]).map(p=> p.id===personId ? {...p, ...updates} : p);
  try{ await db.collection("groups").doc(g.id).update({ personen });
    writeLog(g.id, "person_bearbeitet", `${updates.name||""} wurde bearbeitet`); }
  catch(e){ toast("Fehler: " + e.message); }
}
function deletePerson(g, id){
  if(!isEditable()) return toast("Gruppe wird gerade von jemand anderem bearbeitet.");
  const p = (g.personen||[]).find(x=>x.id===id);
  showConfirm("Diese Person wirklich entfernen?", "Entfernen", async ()=>{
    const personen = (g.personen||[]).filter(x=>x.id!==id);
    const termine = (g.termine||[]).map(t=>{
      const status={...t.status}, notizen={...t.notizen};
      delete status[id]; delete notizen[id];
      return {...t, status, notizen};
    });
    try{ await db.collection("groups").doc(g.id).update({ personen, termine });
      writeLog(g.id, "person_entfernt", `${p?.name||"Person"} wurde entfernt`); }
    catch(e){ toast("Fehler: " + e.message); }
  });
}

// ---------- Aktionen: Termine ----------
async function addTermin(g, termin){
  if(!isEditable()) return toast("Gruppe wird gerade von jemand anderem bearbeitet.");
  const termine = [...(g.termine||[]), { id: uid(), status:{}, notizen:{}, ...termin }];
  termine.sort((a,b)=> (b.datum||"").localeCompare(a.datum||"") || (b.startzeit||"").localeCompare(a.startzeit||""));
  try{ await db.collection("groups").doc(g.id).update({ termine });
    writeLog(g.id, "termin_erstellt", `${termin.bezeichnung} am ${termin.datum}`); }
  catch(e){ toast("Fehler: " + e.message); }
}
function deleteTermin(g, id){
  if(!isEditable()) return toast("Gruppe wird gerade von jemand anderem bearbeitet.");
  const t = getTermin(g,id);
  showConfirm("Diesen Termin wirklich löschen?", "Löschen", async ()=>{
    const termine = (g.termine||[]).filter(x=>x.id!==id);
    try{ await db.collection("groups").doc(g.id).update({ termine }); goto("group",{tab:"termine"});
      writeLog(g.id, "termin_geloescht", `${t?.bezeichnung||"Termin"} wurde gelöscht`); }
    catch(e){ toast("Fehler: " + e.message); }
  });
}
async function setStatus(g, terminId, personId, status){
  if(!isEditable()) return toast("Gruppe wird gerade von jemand anderem bearbeitet.");
  const t = getTermin(g, terminId);
  const p = (g.personen||[]).find(x=>x.id===personId);
  const termine = (g.termine||[]).map(x => x.id===terminId ? {...x, status:{...x.status,[personId]:status}} : x);
  try{ await db.collection("groups").doc(g.id).update({ termine });
    writeLog(g.id, "status_gesetzt", `${p?.name||"?"} bei "${t?.bezeichnung||"?"}" auf "${status}" gesetzt`); }
  catch(e){ toast("Fehler: " + e.message); }
}
async function clearStatus(g, terminId, personId){
  if(!isEditable()) return toast("Gruppe wird gerade von jemand anderem bearbeitet.");
  const t = getTermin(g, terminId);
  const p = (g.personen||[]).find(x=>x.id===personId);
  const termine = (g.termine||[]).map(x=>{
    if(x.id!==terminId) return x;
    const status={...x.status}; delete status[personId];
    return {...x, status};
  });
  try{ await db.collection("groups").doc(g.id).update({ termine });
    writeLog(g.id, "status_zurueckgesetzt", `${p?.name||"?"} bei "${t?.bezeichnung||"?"}" zurückgesetzt`); }
  catch(e){ toast("Fehler: " + e.message); }
}
async function setNote(g, terminId, personId, text){
  const termine = (g.termine||[]).map(t => t.id===terminId ? {...t, notizen:{...t.notizen,[personId]:text}} : t);
  try{ await db.collection("groups").doc(g.id).update({ termine }); }
  catch(e){ toast("Fehler: " + e.message); }
}
function saveNoteField(terminId, personId){
  const input = document.getElementById(`note-${terminId}-${personId}`);
  if(!input) return;
  setNote(currentGroup, terminId, personId, input.value);
  toast("✓ Notiz gespeichert");
}

// ---------- Statistik ----------
function rate(g, personId){
  let total=0, anwesend=0;
  (g.termine||[]).forEach(t=>{ if(t.status && t.status[personId]!==undefined){ total++; if(t.status[personId]==="anwesend") anwesend++; } });
  return total ? Math.round(anwesend/total*1000)/10 : 0;
}
function groupOverallRate(g){
  const rates = (g.personen||[]).map(p=>rate(g,p.id)).filter(r=>!isNaN(r));
  if(!rates.length) return 0;
  return Math.round(rates.reduce((a,b)=>a+b,0)/rates.length*10)/10;
}
function personCounts(g, personId){
  let anwesend=0, entschuldigt=0, abwesend=0;
  (g.termine||[]).forEach(t=>{
    const s = (t.status||{})[personId];
    if(s==="anwesend") anwesend++; else if(s==="entschuldigt") entschuldigt++; else if(s==="abwesend") abwesend++;
  });
  return { anwesend, entschuldigt, abwesend, total: anwesend+entschuldigt+abwesend };
}
function terminCounts(t){
  let anwesend=0, entschuldigt=0, abwesend=0;
  Object.values(t.status||{}).forEach(s=>{
    if(s==="anwesend") anwesend++; else if(s==="entschuldigt") entschuldigt++; else if(s==="abwesend") abwesend++;
  });
  return { anwesend, entschuldigt, abwesend };
}
function renderStatistik(g){
  const overall = groupOverallRate(g);
  const anzahlTermine = (g.termine||[]).length, anzahlPersonen = (g.personen||[]).length;
  const overview = `<div class="stat-cards">
      <div class="stat-card"><div class="stat-num">${overall}%</div><div class="stat-label">Ø Anwesenheit</div></div>
      <div class="stat-card"><div class="stat-num">${anzahlTermine}</div><div class="stat-label">Termine</div></div>
      <div class="stat-card"><div class="stat-num">${anzahlPersonen}</div><div class="stat-label">Personen</div></div>
    </div>`;
  let personTable = anzahlPersonen ? `
      <div class="stat-section-title">Pro Person</div>
      <table class="stat-table"><thead><tr><th>Name</th><th>✔</th><th>⏱</th><th>✘</th><th>Quote</th></tr></thead>
        <tbody>${g.personen.map(p=>{
            const c = personCounts(g, p.id), r = rate(g, p.id);
            return `<tr><td>${escapeHtml(p.name)}</td><td class="c-anwesend">${c.anwesend}</td>
              <td class="c-entschuldigt">${c.entschuldigt}</td><td class="c-abwesend">${c.abwesend}</td>
              <td><div class="mini-bar-bg"><div class="mini-bar-fill" style="width:${r}%"></div></div><span class="mini-bar-pct">${r}%</span></td></tr>`;
          }).join("")}</tbody></table>` : `<div class="empty">Keine Personen vorhanden.</div>`;
  let terminTable = anzahlTermine ? `
      <div class="stat-section-title">Pro Termin</div>
      <table class="stat-table"><thead><tr><th>Termin</th><th>✔</th><th>⏱</th><th>✘</th></tr></thead>
        <tbody>${g.termine.map(t=>{
            const c = terminCounts(t);
            return `<tr><td>${escapeHtml(t.bezeichnung)}<br><small style="color:var(--muted)">${formatDatum(t.datum)}</small></td>
              <td class="c-anwesend">${c.anwesend}</td><td class="c-entschuldigt">${c.entschuldigt}</td><td class="c-abwesend">${c.abwesend}</td></tr>`;
          }).join("")}</tbody></table>` : "";
  return overview + personTable + terminTable;
}

// ---------- Export ----------
function exportCSV(g){
  let rows=[["Datum","Von","Bis","Termin","Ort","Person","Status","Notiz"]];
  (g.termine||[]).forEach(t=>{
    (g.personen||[]).forEach(p=>{
      rows.push([t.datum||"", t.startzeit||"", t.endzeit||"", t.bezeichnung||"", t.ort||"", p.name, (t.status||{})[p.id]||"-", (t.notizen||{})[p.id]||""]);
    });
  });
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${g.name}_export.csv`; a.click();
}

// ---------- Mitarbeiter / Einladungen ----------
async function inviteMitarbeiter(g, emailRaw){
  const email = emailRaw.trim().toLowerCase();
  if(!email || !email.includes("@")) return toast("Bitte gültige E-Mail eingeben.");
  if(g.members && g.members.some(u => (g.memberInfo?.[u]?.email||"").toLowerCase()===email)) return toast("Diese Person ist bereits Mitarbeiter.");
  try{
    await db.collection("invites").doc(email).set({ groupIds: firebase.firestore.FieldValue.arrayUnion(g.id), invitedBy: currentUser.email }, { merge: true });
    await db.collection("groups").doc(g.id).update({ [`pendingInvites.${email}`]: { invitedAt: nowMs(), invitedBy: currentUser.email } });
    const actionCodeSettings = { url: window.location.origin + window.location.pathname.replace(/[^/]+$/, "") + "login.html", handleCodeInApp: true };
    await auth.sendSignInLinkToEmail(email, actionCodeSettings);
    writeLog(g.id, "mitarbeiter_eingeladen", `${email} wurde eingeladen`);
    toast("Einladung an " + email + " gesendet");
  }catch(e){ toast("Fehler beim Einladen: " + e.message); }
}
async function removeMitarbeiter(g, memberUid){
  const info = (g.memberInfo||{})[memberUid];
  showConfirm("Diesen Mitarbeiter aus der Gruppe entfernen?", "Entfernen", async ()=>{
    try{
      await db.collection("groups").doc(g.id).update({
        members: firebase.firestore.FieldValue.arrayRemove(memberUid),
        [`memberInfo.${memberUid}`]: firebase.firestore.FieldValue.delete()
      });
      writeLog(g.id, "mitarbeiter_entfernt", `${info?.name||info?.email||"Mitarbeiter"} wurde entfernt`);
      toast("Mitarbeiter entfernt");
    }catch(e){ toast("Fehler: " + e.message); }
  });
}
async function editMitarbeiterInfo(g, memberUid, newName){
  try{
    await db.collection("groups").doc(g.id).update({ [`memberInfo.${memberUid}.name`]: newName });
    writeLog(g.id, "mitarbeiter_bearbeitet", `Anzeigename geändert zu "${newName}"`);
    toast("Gespeichert");
  }catch(e){ toast("Fehler: " + e.message); }
}
async function cancelInvite(g, email){
  try{
    await db.collection("groups").doc(g.id).update({ [`pendingInvites.${email}`]: firebase.firestore.FieldValue.delete() });
    await db.collection("invites").doc(email).update({ groupIds: firebase.firestore.FieldValue.arrayRemove(g.id) }).catch(()=>{});
    toast("Einladung zurückgezogen");
  }catch(e){ toast("Fehler: " + e.message); }
}
async function resetPasswordFor(email){
  try{ await auth.sendPasswordResetEmail(email); toast("Passwort-Reset an " + email + " gesendet"); }
  catch(e){ toast("Fehler: " + e.message); }
}

// ---------- E-Mail-Verifizierung (6-stelliger Code) ----------
async function sendNewVerificationCode(){
  const code = genCode();
  try{
    await db.collection("emailVerifications").doc(currentUser.uid).set({ code, email: currentUser.email, createdAt: nowMs() });
    await sendVerificationEmail(currentUser.email, currentUserData?.name, code);
    toast("Code wurde gesendet – auch im Spam-Ordner nachsehen.");
  }catch(e){ toast("Fehler beim Senden: " + e.message); }
}
function resendVerificationCode(){ sendNewVerificationCode(); }
async function submitVerifyCode(){
  const input = document.getElementById("verifyCodeInput");
  const code = input.value.trim();
  if(code.length!==6) return toast("Bitte den 6-stelligen Code eingeben.");
  try{
    const snap = await db.collection("emailVerifications").doc(currentUser.uid).get();
    if(!snap.exists) return toast("Kein Code angefordert. Bitte erneut senden.");
    const data = snap.data();
    if(nowMs() - data.createdAt > 15*60*1000) return toast("Code abgelaufen. Bitte neuen anfordern.");
    if(data.code !== code) return toast("Falscher Code.");
    await db.collection("users").doc(currentUser.uid).update({ emailVerified: true });
    await db.collection("emailVerifications").doc(currentUser.uid).delete();
    currentUserData.emailVerified = true;
    toast("E-Mail bestätigt!");
    goto("groups");
  }catch(e){ toast("Fehler: " + e.message); }
}

// ---------- Konto ----------
async function requestEmailChange(){
  const newEmail = document.getElementById("newEmailInput").value.trim().toLowerCase();
  if(!newEmail || !newEmail.includes("@")) return toast("Bitte gültige E-Mail eingeben.");
  if(newEmail === currentUser.email.toLowerCase()) return toast("Das ist bereits deine aktuelle E-Mail.");
  const code = genCode();
  try{
    await db.collection("emailChangeRequests").doc(currentUser.uid).set({ code, pendingEmail: newEmail, createdAt: nowMs() });
    await sendVerificationEmail(newEmail, currentUserData?.name, code);
    toast("Code an neue Adresse gesendet.");
    render();
    setTimeout(()=>{ document.getElementById("emailChangeCodeBox")?.classList.add("show"); }, 50);
  }catch(e){ toast("Fehler: " + e.message); }
}
async function confirmEmailChange(){
  const code = document.getElementById("emailChangeCodeInput").value.trim();
  try{
    const snap = await db.collection("emailChangeRequests").doc(currentUser.uid).get();
    if(!snap.exists) return toast("Keine Änderung angefordert.");
    const data = snap.data();
    if(nowMs() - data.createdAt > 15*60*1000) return toast("Code abgelaufen.");
    if(data.code !== code) return toast("Falscher Code.");
    await currentUser.updateEmail(data.pendingEmail);
    await db.collection("users").doc(currentUser.uid).update({ email: data.pendingEmail });
    await db.collection("emailChangeRequests").doc(currentUser.uid).delete();
    currentUserData.email = data.pendingEmail;
    toast("E-Mail geändert!");
    render();
  }catch(e){
    if(e.code === "auth/requires-recent-login") toast("Bitte ab- und wieder anmelden, dann erneut versuchen.");
    else toast("Fehler: " + e.message);
  }
}
async function resendVerification(){
  try{
    await currentUser.reload();
    await currentUser.sendEmailVerification();
    toast("Firebase-Standard-Bestätigungsmail erneut gesendet.");
  }catch(e){ toast("Fehler: " + e.message); }
}
async function selfPasswordReset(){
  try{ await auth.sendPasswordResetEmail(currentUser.email); toast("E-Mail zum Passwort-Ändern gesendet"); }
  catch(e){ toast("Fehler: " + e.message); }
}
async function deleteAccount(){
  showConfirm("Dein Konto und alle eigenen Gruppen werden unwiderruflich gelöscht. Fortfahren?", "Konto löschen", async ()=>{
    try{
      const ownedSnap = await db.collection("groups").where("ownerUid","==",currentUser.uid).get();
      for(const doc of ownedSnap.docs){ await doc.ref.delete(); }
      const memberSnap = await db.collection("groups").where("members","array-contains",currentUser.uid).get();
      for(const doc of memberSnap.docs){
        await doc.ref.update({ members: firebase.firestore.FieldValue.arrayRemove(currentUser.uid), [`memberInfo.${currentUser.uid}`]: firebase.firestore.FieldValue.delete() });
      }
      await db.collection("users").doc(currentUser.uid).delete().catch(()=>{});
      await currentUser.delete();
      window.location.href = "login.html";
    }catch(e){
      if(e.code === "auth/requires-recent-login") toast("Bitte melde dich ab und wieder an, dann versuche es erneut.");
      else toast("Fehler: " + e.message);
    }
  });
}

// ---------- Modals ----------
function showModal(html, onOpen){
  const bg = document.createElement("div"); bg.className = "modal-bg"; bg.id = "modalBg";
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener("click", e=>{ if(e.target===bg) closeModal(); });
  document.body.appendChild(bg);
  if(onOpen) onOpen();
}
function closeModal(){ document.getElementById("modalBg")?.remove(); }

function modalNewGroup(){
  showModal(`<h3>Neue Gruppe</h3>
    <input id="mGroupName" type="text" placeholder="Gruppenname (z. B. Fussball U12)">
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="submitGroup()">Erstellen</button>
    </div>`, ()=>document.getElementById("mGroupName").focus());
}
function submitGroup(){ const n=document.getElementById("mGroupName").value.trim(); if(!n)return; addGroup(n); closeModal(); }

function personFormHtml(p={}){
  const existingNames = (currentGroup?.personen||[]).map(x=>x.ausgebildetDurch).filter(Boolean);
  return `
    <div class="field-label">Roblox Name (Anzeigename) *</div>
    <input id="mPersonName" type="text" placeholder="Roblox-Anzeigename" value="${escapeAttr(p.name)}">
    <div class="field-label">Discord Name</div>
    <input id="mPersonDiscord" type="text" placeholder="z. B. name#0000" value="${escapeAttr(p.discordName)}">
    <div class="field-label">Eintrittsdatum</div>
    <input id="mPersonEintritt" type="date" value="${escapeAttr(p.eintrittsdatum)}">
    <div class="field-label">Ausgebildet durch</div>
    <input id="mPersonAusbilder" type="text" placeholder="Name der ausbildenden Person" value="${escapeAttr(p.ausgebildetDurch)}" list="ausbilderList">
    <datalist id="ausbilderList">${[...new Set(existingNames)].map(n=>`<option value="${escapeAttr(n)}">`).join("")}</datalist>
    <div class="field-label">Rolle</div>
    <select id="mPersonRolle">
      <option value="" ${!p.rolle?"selected":""}>– Keine Angabe –</option>
      <option value="HR" ${p.rolle==="HR"?"selected":""}>HR</option>
      <option value="FDL" ${p.rolle==="FDL"?"selected":""}>FDL</option>
      <option value="TF" ${p.rolle==="TF"?"selected":""}>TF</option>
    </select>`;
}
function modalNewPerson(){
  showModal(`<h3>Neue Person</h3>${personFormHtml()}
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="submitPerson()">Hinzufügen</button>
    </div>`, ()=>document.getElementById("mPersonName").focus());
}
function readPersonForm(){
  return {
    name: document.getElementById("mPersonName").value.trim(),
    discordName: document.getElementById("mPersonDiscord").value.trim(),
    eintrittsdatum: document.getElementById("mPersonEintritt").value,
    ausgebildetDurch: document.getElementById("mPersonAusbilder").value.trim(),
    rolle: document.getElementById("mPersonRolle").value
  };
}
function submitPerson(){
  const data = readPersonForm();
  if(!data.name) return toast("Bitte einen Roblox Namen eingeben.");
  addPerson(currentGroup, data);
  closeModal();
}
function modalEditPerson(personId){
  const p = (currentGroup.personen||[]).find(x=>x.id===personId);
  if(!p) return;
  showModal(`<h3>Person bearbeiten</h3>${personFormHtml(p)}
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="submitEditPerson('${personId}')">Speichern</button>
    </div>`);
}
function submitEditPerson(personId){
  const data = readPersonForm();
  if(!data.name) return toast("Bitte einen Roblox Namen eingeben.");
  updatePerson(currentGroup, personId, data);
  closeModal();
}

function modalNewTermin(){
  const today = new Date().toISOString().slice(0,10);
  showModal(`<h3>Neuer Termin</h3>
    <div class="field-label">Bezeichnung *</div>
    <input id="mTerminName" type="text" placeholder="z. B. Training, Vereinssitzung">
    <div class="field-label">Datum *</div>
    <input id="mTerminDatum" type="date" value="${today}">
    <div class="field-label">Uhrzeit</div>
    <div class="field-row">
      <input id="mTerminVon" type="time" placeholder="von">
      <input id="mTerminBis" type="time" placeholder="bis">
    </div>
    <div class="field-label">Ort (optional)</div>
    <input id="mTerminOrt" type="text" placeholder="z. B. Sporthalle Nord">
    <div class="field-label">Beschreibung (optional)</div>
    <input id="mTerminBeschreibung" type="text" placeholder="Zusätzliche Infos">
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="submitTermin()">Erstellen</button>
    </div>`, ()=>document.getElementById("mTerminName").focus());
}
function submitTermin(){
  const bezeichnung = document.getElementById("mTerminName").value.trim();
  const datum = document.getElementById("mTerminDatum").value;
  if(!bezeichnung || !datum) return toast("Bitte Bezeichnung und Datum angeben.");
  addTermin(currentGroup, {
    bezeichnung, datum,
    startzeit: document.getElementById("mTerminVon").value,
    endzeit: document.getElementById("mTerminBis").value,
    ort: document.getElementById("mTerminOrt").value.trim(),
    beschreibung: document.getElementById("mTerminBeschreibung").value.trim()
  });
  closeModal();
}

function modalInvite(){
  showModal(`<h3>Mitarbeiter einladen</h3>
    <p style="color:var(--muted);font-size:13px;margin-top:-8px;">Die Person erhält eine E-Mail mit einem Anmeldelink. Besteht bereits ein Konto, wird sie direkt angemeldet – sonst automatisch registriert.</p>
    <input id="mInviteEmail" type="email" placeholder="mitarbeiter@beispiel.de">
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="submitInvite()">Einladen</button>
    </div>`, ()=>document.getElementById("mInviteEmail").focus());
}
function submitInvite(){ const email = document.getElementById("mInviteEmail").value; closeModal(); inviteMitarbeiter(currentGroup, email); }

function modalEditMitarbeiter(memberUid){
  const info = (currentGroup.memberInfo||{})[memberUid] || {};
  showModal(`<h3>Mitarbeiter bearbeiten</h3>
    <div class="field-label">Anzeigename in dieser Gruppe</div>
    <input id="mEditMitarbeiterName" type="text" value="${escapeAttr(info.name)}">
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="submitEditMitarbeiter('${memberUid}')">Speichern</button>
    </div>`, ()=>document.getElementById("mEditMitarbeiterName").focus());
}
function submitEditMitarbeiter(memberUid){
  const name = document.getElementById("mEditMitarbeiterName").value.trim();
  if(!name) return toast("Bitte einen Namen eingeben.");
  editMitarbeiterInfo(currentGroup, memberUid, name);
  closeModal();
}

// ---------- Rendering ----------
function render(){
  // Sicherstellen, dass ein unbestätigtes Konto sofort die Verifizierung sieht –
  // unabhängig davon, wie render() ausgelöst wurde (nicht nur über goto()).
  if(!currentUserData?.emailVerified && nav.view!=="verify" && nav.view!=="konto"){
    nav.view = "verify";
  }

  const app = document.getElementById("app");
  const back = document.getElementById("backBtn");
  const exportBtn = document.getElementById("exportBtn");
  const title = document.getElementById("pageTitle");
  const fab = document.getElementById("fabBtn");
  back.style.visibility = (nav.view==="groups") ? "hidden" : "visible";
  exportBtn.style.visibility = "hidden";
  fab.style.display = "block";

  if(nav.view==="verify"){
    title.textContent = "E-Mail bestätigen"; back.style.visibility="hidden"; fab.style.display="none";
    app.innerHTML = `<div class="account-card" style="text-align:center;">
      <h3>Fast geschafft!</h3>
      <p>Wir haben einen 6-stelligen Code an <b>${escapeHtml(currentUser.email)}</b> gesendet.<br>Bitte gib ihn unten ein, um dein Konto zu aktivieren.</p>
      <input id="verifyCodeInput" type="text" inputmode="numeric" maxlength="6" placeholder="123456"
        style="text-align:center;font-size:24px;letter-spacing:8px;">
      <button class="btn btn-primary" onclick="submitVerifyCode()">Bestätigen</button>
      <p class="auth-link"><a href="#" onclick="resendVerificationCode();return false;">Code erneut senden</a></p>
    </div>`;
    return;
  }

  if(nav.view==="groups"){
    title.textContent = "Anwesenheits Check";
    fab.onclick = modalNewGroup;
    app.innerHTML = `
      <div class="filter-bar">
        <input type="text" id="groupSearchInput" placeholder="🔍 Gruppe suchen…" value="${escapeAttr(groupsFilter.search)}">
        <div class="filter-chips">
          <span class="chip ${groupsFilter.owner==='all'?'active':''}" onclick="setGroupsFilter('all')">Alle</span>
          <span class="chip ${groupsFilter.owner==='own'?'active':''}" onclick="setGroupsFilter('own')">Meine</span>
          <span class="chip ${groupsFilter.owner==='shared'?'active':''}" onclick="setGroupsFilter('shared')">Geteilte</span>
        </div>
      </div>
      <div id="groupsList"></div>`;
    document.getElementById("groupSearchInput").addEventListener("input", e=>{ groupsFilter.search = e.target.value; renderGroupsList(); });
    renderGroupsList();
    return;
  }

  if(nav.view==="konto"){ renderKonto(); return; }

  const g = currentGroup;
  if((nav.view==="group" || nav.view==="termin") && !g){ app.innerHTML = `<div class="empty">Lade Gruppe…</div>`; return; }

  if(nav.view==="group"){ renderGroup(g); return; }
  if(nav.view==="termin"){ renderTermin(g); return; }
}

function renderGroupsList(){
  const list = filteredGroups();
  document.getElementById("groupsList").innerHTML = list.length ? list.map(g=>`
      <div class="card" onclick="openGroup('${g.id}')">
        <div class="info"><b>${escapeHtml(g.name)}</b><span>${(g.personen||[]).length} Personen · ${(g.termine||[]).length} Termine ${isOwner(g)?"":"· Mitarbeiter"}</span></div>
        <span class="badge">›</span>
      </div>`).join("") : `<div class="empty">Keine Gruppen gefunden.</div>`;
}
function setGroupsFilter(owner){ groupsFilter.owner = owner; renderGroupsList(); }

function renderKonto(){
  const title = document.getElementById("pageTitle"); title.textContent = "Mein Konto";
  document.getElementById("fabBtn").style.display = "none";
  const app = document.getElementById("app");
  const s = currentUserData?.settings || {};
  const verified = currentUserData?.emailVerified === true;
  app.innerHTML = `
      <div class="account-card">
        <h3>${escapeHtml(currentUserData?.name || "")}</h3>
        <p>${escapeHtml(currentUser.email)}</p>
        <span class="verify-badge ${verified?'ok':'no'}">${verified?"✔ Konto bestätigt":"⚠ Noch nicht bestätigt"}</span>
        ${!verified ? `<div><button class="btn btn-primary" onclick="goto('verify')">Jetzt bestätigen</button></div>` : ""}
      </div>
      <div class="account-card">
        <h3>E-Mail-Adresse ändern</h3>
        <p>Nach Eingabe einer neuen Adresse senden wir dir einen 6-stelligen Bestätigungscode dorthin.</p>
        <input id="newEmailInput" type="email" placeholder="neue@adresse.de">
        <button class="btn btn-secondary" onclick="requestEmailChange()">Code senden</button>
        <div id="emailChangeCodeBox" class="code-box">
          <div class="field-label">Code aus der neuen E-Mail</div>
          <input id="emailChangeCodeInput" type="text" inputmode="numeric" maxlength="6" placeholder="123456">
          <button class="btn btn-primary" onclick="confirmEmailChange()">E-Mail-Änderung bestätigen</button>
        </div>
      </div>
      <div class="account-card">
        <h3>Passwort</h3>
        <p>Wir senden dir einen Link zum Ändern deines Passworts per E-Mail.</p>
        <button class="btn btn-secondary" onclick="selfPasswordReset()">Passwort ändern</button>
      </div>
      <div class="account-card">
        <h3>Einstellungen</h3>
        <div class="settings-row">
          <span>Automatische Aktualisierung (60s)</span>
          <label class="mini-toggle"><input type="checkbox" id="settingsAutoRefresh" ${autoRefreshEnabled?"checked":""}><span></span></label>
        </div>
        <div class="settings-row">
          <span>Dark Mode</span>
          <label class="mini-toggle"><input type="checkbox" id="settingsDarkMode" ${s.darkMode?"checked":""}><span></span></label>
        </div>
      </div>
      <div class="account-card">
        <h3 style="color:var(--abwesend)">Konto löschen</h3>
        <p>Löscht dein Konto sowie alle Gruppen, deren Ersteller du bist, unwiderruflich.</p>
        <button class="btn" style="background:var(--abwesend);color:#fff;" onclick="deleteAccount()">Konto endgültig löschen</button>
      </div>`;
  document.getElementById("settingsAutoRefresh").addEventListener("change", e=>{
    autoRefreshEnabled = e.target.checked; saveSetting("autoRefresh", autoRefreshEnabled);
    const w = document.getElementById("refreshToggle"); if(w) w.checked = autoRefreshEnabled;
    if(autoRefreshEnabled) applyPending();
    updateCountdownDisplay();
  });
  document.getElementById("settingsDarkMode").addEventListener("change", e=> toggleDarkMode(e.target.checked));
}

function renderGroup(g){
  const title = document.getElementById("pageTitle"); title.textContent = g.name;
  const exportBtn = document.getElementById("exportBtn"); exportBtn.style.visibility = "visible"; exportBtn.onclick = ()=>exportCSV(g);
  const fab = document.getElementById("fabBtn");
  const owner = isOwner(g), editable = isEditable();
  fab.onclick = nav.tab==="termine" ? modalNewTermin : (nav.tab==="personen" ? modalNewPerson : (nav.tab==="mitarbeiter" ? modalInvite : null));
  fab.style.display = (nav.tab==="statistik" || nav.tab==="logs" || (!editable && nav.tab!=="mitarbeiter") || (nav.tab==="mitarbeiter" && !owner)) ? "none" : "block";

  let lockBanner = "";
  if(g.editLock && g.editLock.uid !== currentUser.uid && (nowMs()-g.editLock.ts) < 25000){
    lockBanner = `<div class="lock-banner">🔒 Diese Gruppe wird gerade von <b>${escapeHtml(g.editLock.name)}</b> bearbeitet. Du kannst zusehen, aber nicht gleichzeitig eintragen.</div>`;
  } else if(editable){
    lockBanner = `<div class="lock-banner mine">✏️ Du bearbeitest diese Gruppe gerade live.</div>`;
  }

  let body = "";
  if(nav.tab==="termine"){
    body = (g.termine||[]).length ? g.termine.map(t=>`
        <div class="card" onclick="goto('termin',{terminId:'${t.id}'})">
          <div class="info"><b>${escapeHtml(t.bezeichnung)}</b><span>${formatDatum(t.datum)}${t.startzeit?` · ${t.startzeit}${t.endzeit?'–'+t.endzeit:''} Uhr`:''}${t.ort?' · '+escapeHtml(t.ort):''}</span></div>
          <span class="badge">${Object.keys(t.status||{}).length}/${(g.personen||[]).length}</span>
        </div>`).join("") : `<div class="empty">Noch keine Termine.<br>Tippe auf + für einen neuen Termin.</div>`;
  } else if(nav.tab==="personen"){
    body = (g.personen||[]).length ? g.personen.map(p=>`
        <div class="row" style="display:block;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div class="name">${escapeHtml(p.name)}
              ${p.rolle?`<span class="pill">${escapeHtml(p.rolle)}</span>`:''}
              <small>${p.discordName?('Discord: '+escapeHtml(p.discordName)):''}</small>
              <small>${p.eintrittsdatum?('Eintritt: '+formatDatum(p.eintrittsdatum)):''}</small>
              <small>${p.ausgebildetDurch?('Ausgebildet durch: '+escapeHtml(p.ausgebildetDurch)):''}</small>
            </div>
            ${editable ? `<div class="m-actions"><button onclick="modalEditPerson('${p.id}')">✎</button><button class="danger" onclick="deletePerson(currentGroup,'${p.id}')">Entfernen</button></div>` : ""}
          </div>
        </div>`).join("") : `<div class="empty">Noch keine Personen.<br>Tippe auf + um jemanden hinzuzufügen.</div>`;
  } else if(nav.tab==="mitarbeiter"){
    const members = g.members||[]; const pending = Object.entries(g.pendingInvites||{});
    body = members.map(mUid=>{
      const info = (g.memberInfo||{})[mUid] || {}; const own = mUid===g.ownerUid;
      return `<div class="mitarbeiter-row">
          <div class="m-info"><b>${escapeHtml(info.name||info.email||"Unbekannt")}</b><span>${escapeHtml(info.email||"")}</span></div>
          <div class="m-actions">
            <span class="pill ${own?'owner':''}">${own?"Ersteller":"Mitarbeiter"}</span>
            ${(owner && !own) ? `<button onclick="modalEditMitarbeiter('${mUid}')">✎</button>` : ""}
            ${(owner && !own) ? `<button onclick="resetPasswordFor('${info.email}')">🔑</button>` : ""}
            ${(owner && !own) ? `<button class="danger" onclick="removeMitarbeiter(currentGroup,'${mUid}')">Entfernen</button>` : ""}
          </div>
        </div>`;
    }).join("") + pending.map(([email])=>`
        <div class="mitarbeiter-row">
          <div class="m-info"><b>${escapeHtml(email)}</b><span>Einladung ausstehend</span></div>
          <div class="m-actions"><span class="pill pending">Ausstehend</span>${owner ? `<button class="danger" onclick="cancelInvite(currentGroup,'${email}')">Zurückziehen</button>` : ""}</div>
        </div>`).join("");
    if(!members.length && !pending.length) body = `<div class="empty">Noch keine Mitarbeiter.</div>`;
    if(!owner) body = `<div class="empty" style="padding-bottom:6px;">Nur der Ersteller kann Mitarbeiter verwalten.</div>` + body;
  } else if(nav.tab==="statistik"){
    body = renderStatistik(g);
  } else if(nav.tab==="logs"){
    body = owner ? renderLogs() : `<div class="empty">Nur der Ersteller kann das Verlaufsprotokoll einsehen.</div>`;
  }

  const tabsHtml = `<div class="tabs">
      <div class="tab ${nav.tab==='termine'?'active':''}" onclick="goto('group',{tab:'termine'})">Termine</div>
      <div class="tab ${nav.tab==='personen'?'active':''}" onclick="goto('group',{tab:'personen'})">Personen</div>
      <div class="tab ${nav.tab==='mitarbeiter'?'active':''}" onclick="goto('group',{tab:'mitarbeiter'})">Team</div>
      <div class="tab ${nav.tab==='statistik'?'active':''}" onclick="goto('group',{tab:'statistik'})">Statistik</div>
      ${owner ? `<div class="tab ${nav.tab==='logs'?'active':''}" onclick="goto('group',{tab:'logs'})">Logs</div>` : ""}
    </div>`;

  document.getElementById("app").innerHTML = lockBanner + tabsHtml + body +
    ((nav.tab==='termine' && owner) ? `<div class="empty" style="padding-top:6px;"><span class="del" style="color:var(--muted)" onclick="deleteGroup(currentGroup)">Gruppe löschen</span></div>` : "");
}

function renderLogs(){
  if(!currentLogs.length) return `<div class="empty">Noch keine Einträge im Verlauf.</div>`;
  const actionLabels = {
    person_hinzugefuegt: "➕ Person hinzugefügt", person_bearbeitet: "✎ Person bearbeitet", person_entfernt: "🗑 Person entfernt",
    termin_erstellt: "📅 Termin erstellt", termin_geloescht: "🗑 Termin gelöscht",
    status_gesetzt: "✅ Status gesetzt", status_zurueckgesetzt: "↺ Status zurückgesetzt",
    mitarbeiter_eingeladen: "✉️ Mitarbeiter eingeladen", mitarbeiter_beigetreten: "🎉 Mitarbeiter beigetreten",
    mitarbeiter_entfernt: "🚪 Mitarbeiter entfernt", mitarbeiter_bearbeitet: "✎ Mitarbeiter bearbeitet"
  };
  return `<div class="log-list">` + currentLogs.map(l=>{
    const time = l.ts?.toDate ? l.ts.toDate().toLocaleString("de-DE") : "gerade eben";
    return `<div class="log-row">
        <div class="log-action">${actionLabels[l.action]||l.action}</div>
        <div class="log-details">${escapeHtml(l.details||"")}</div>
        <div class="log-meta">${escapeHtml(l.name)} · ${time}</div>
      </div>`;
  }).join("") + `</div>`;
}

function renderTermin(g){
  const t = getTermin(g, nav.terminId);
  if(!t){ goto("group",{tab:"termine"}); return; }
  document.getElementById("pageTitle").textContent = t.bezeichnung + " · " + formatDatum(t.datum);
  document.getElementById("fabBtn").style.display = "none";
  const editable = isEditable();

  let lockBanner = "";
  if(g.editLock && g.editLock.uid !== currentUser.uid && (nowMs()-g.editLock.ts) < 25000){
    lockBanner = `<div class="lock-banner">🔒 Wird gerade von <b>${escapeHtml(g.editLock.name)}</b> bearbeitet – nur Ansicht möglich.</div>`;
  }

  const rows = (g.personen||[]).length ? g.personen.map(p=>{
      const st = (t.status||{})[p.id];
      const cls = s => st===s ? `on-${s}` : "";
      const dis = editable ? "" : "disabled";
      return `<div class="row" style="display:block;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="status-btns ${dis}">
            <button class="${cls('anwesend')}" onclick="setStatus(currentGroup,'${t.id}','${p.id}','anwesend')">Anwesend</button>
            <button class="${cls('entschuldigt')}" onclick="setStatus(currentGroup,'${t.id}','${p.id}','entschuldigt')">Entschuldigt</button>
            <button class="${cls('abwesend')}" onclick="setStatus(currentGroup,'${t.id}','${p.id}','abwesend')">Abwesend</button>
            <button class="clear-btn ${dis}" title="Zurücksetzen" onclick="clearStatus(currentGroup,'${t.id}','${p.id}')">↺</button>
          </div>
        </div>
        <div class="note-row ${dis}">
          <input class="note-input show" id="note-${t.id}-${p.id}" placeholder="Notiz zu dieser Person bei diesem Termin..." value="${escapeAttr((t.notizen||{})[p.id]||'')}">
          <button class="note-save-btn" title="Notiz speichern" onclick="saveNoteField('${t.id}','${p.id}')">💾</button>
        </div>
      </div>`;
    }).join("") : `<div class="empty">Diese Gruppe hat noch keine Personen.</div>`;

  const deleteLink = editable ? `<div class="empty" style="padding-top:10px;"><span class="del" onclick="deleteTermin(currentGroup,'${t.id}')">Termin löschen</span></div>` : "";
  const saveBar = editable ? `<button class="btn save-btn-inline" onclick="manualSave()">💾 Speichern</button>` : "";

  document.getElementById("app").innerHTML = lockBanner + rows + deleteLink + saveBar;
}

function formatDatum(d){
  if(!d) return "";
  const [y,m,day] = d.split("-");
  return `${day}.${m}.${y}`;
}
function escapeHtml(str){
  if(str===undefined||str===null) return "";
  return String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(str){ return escapeHtml(str); }

document.getElementById("backBtn").addEventListener("click", ()=>{
  if(nav.view==="termin") goto("group",{tab:"termine"});
  else if(nav.view==="group" || nav.view==="konto") goto("groups");
});
