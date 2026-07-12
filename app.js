// ==========================================================
// Anwesenheits Check – App-Logik (Version 2)
// Datenmodell (Firestore):
//   groups/{groupId}        – eine Gruppe (Owner + Mitarbeiter, Personen, Termine)
//   users/{uid}              – Profildaten des angemeldeten Nutzers
//   invites/{emailLowercase} – offene Einladungen (groupIds-Array)
// Es wird nichts anwesenheitsrelevantes im Browser gespeichert.
// ==========================================================

let currentUser = null;
let currentUserData = null;
let groupsOwner = [];
let groupsMember = [];
let unsubOwner = null, unsubMember = null, unsubGroup = null;
let heartbeatTimer = null;
let currentGroup = null; // live-gespiegeltes Dokument der offenen Gruppe
let iHoldLock = false;

let nav = { view: "groups", groupId: null, tab: "termine", terminId: null };
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function nowMs(){ return Date.now(); }

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
  loadUserGroups();
  render();
});

async function ensureUserDoc(user){
  const ref = db.collection("users").doc(user.uid);
  const snap = await ref.get();
  if(!snap.exists){
    await ref.set({
      name: user.displayName || (user.email ? user.email.split("@")[0] : "Nutzer"),
      email: (user.email||"").toLowerCase(),
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
    }catch(e){ console.error("Einladung konnte nicht verarbeitet werden:", e); }
  }
  await inviteRef.delete().catch(()=>{});
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  showConfirm("Möchtest du dich wirklich abmelden?", "Abmelden", async () => {
    await releaseLock();
    cleanupListeners();
    auth.signOut().then(()=> window.location.href = "login.html");
  });
});

document.getElementById("accountBtn")?.addEventListener("click", () => goto("konto"));

function cleanupListeners(){
  if(unsubOwner) unsubOwner();
  if(unsubMember) unsubMember();
  if(unsubGroup) unsubGroup();
  if(heartbeatTimer) clearInterval(heartbeatTimer);
}

window.addEventListener("beforeunload", () => { releaseLock(true); });

// ---------- Live-Gruppenliste ----------
function loadUserGroups(){
  if(unsubOwner) unsubOwner();
  if(unsubMember) unsubMember();
  unsubOwner = db.collection("groups").where("ownerUid","==",currentUser.uid)
    .onSnapshot(snap => { groupsOwner = snap.docs.map(d=>({id:d.id, ...d.data()})); if(nav.view==="groups") render(); },
      err => toast("Fehler beim Laden: " + err.message));
  unsubMember = db.collection("groups").where("members","array-contains",currentUser.uid)
    .onSnapshot(snap => { groupsMember = snap.docs.map(d=>({id:d.id, ...d.data()})); if(nav.view==="groups") render(); },
      err => toast("Fehler beim Laden: " + err.message));
}
function allMyGroups(){
  const map = new Map();
  [...groupsOwner, ...groupsMember].forEach(g => map.set(g.id, g));
  return [...map.values()].sort((a,b)=> (a.name||"").localeCompare(b.name||""));
}

// ---------- Gruppe öffnen / schließen + Live-Sperre ----------
async function openGroup(groupId){
  goto("group", { groupId, tab: "termine" });
}

function subscribeGroup(groupId){
  if(unsubGroup) unsubGroup();
  currentGroup = null;
  unsubGroup = db.collection("groups").doc(groupId).onSnapshot(doc => {
    if(!doc.exists){ currentGroup = null; goto("groups"); return; }
    currentGroup = { id: doc.id, ...doc.data() };
    tryAcquireLock(groupId);
    render();
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
      } else {
        iHoldLock = false;
      }
    });
  }catch(e){ console.error(e); iHoldLock = false; }
  startHeartbeat(groupId);
}

function startHeartbeat(groupId){
  if(heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if(!iHoldLock || !currentGroup || currentGroup.id !== groupId) return;
    db.collection("groups").doc(groupId).update({ "editLock.ts": nowMs() }).catch(()=>{});
  }, 10000);
}

async function releaseLock(sync=false){
  if(!iHoldLock || !currentGroup) return;
  const ref = db.collection("groups").doc(currentGroup.id);
  iHoldLock = false;
  try{ await ref.update({ editLock: null }); }catch(e){ /* ignore */ }
}

function closeGroup(){
  releaseLock();
  if(unsubGroup) unsubGroup();
  unsubGroup = null;
  currentGroup = null;
  if(heartbeatTimer) clearInterval(heartbeatTimer);
}

function isEditable(){
  return currentGroup && iHoldLock;
}
function isOwner(g){ return g && currentUser && g.ownerUid === currentUser.uid; }

// ---------- Navigation ----------
function goto(view, extra={}){
  if(nav.view==="group" && view!=="group" && view!=="termin") closeGroup();
  nav = { view, groupId: nav.groupId, tab: nav.tab, terminId: nav.terminId, ...extra };
  if(view==="group" && (!currentGroup || currentGroup.id!==nav.groupId)) subscribeGroup(nav.groupId);
  render();
}
function getTermin(g, id){ return (g.termine||[]).find(t=>t.id===id); }

// ---------- Toast ----------
let toastTimeout=null;
function toast(msg){
  let el = document.getElementById("toastEl");
  if(!el){ el = document.createElement("div"); el.id="toastEl"; el.className="toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(()=> el.style.display="none", 3200);
}

// ---------- Bestätigungs-Dialog (statt window.confirm) ----------
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
      name,
      ownerUid: currentUser.uid,
      ownerEmail: currentUser.email,
      members: [currentUser.uid],
      memberInfo: { [currentUser.uid]: { email: currentUser.email, name: currentUserData?.name || currentUser.email, addedAt: nowMs(), role: "owner" } },
      pendingInvites: {},
      personen: [], termine: [], editLock: null,
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
  try{ await db.collection("groups").doc(g.id).update({ personen }); }
  catch(e){ toast("Fehler: " + e.message); }
}
function deletePerson(g, id){
  if(!isEditable()) return toast("Gruppe wird gerade von jemand anderem bearbeitet.");
  showConfirm("Diese Person wirklich entfernen?", "Entfernen", async ()=>{
    const personen = (g.personen||[]).filter(p=>p.id!==id);
    const termine = (g.termine||[]).map(t=>{
      const status={...t.status}, notizen={...t.notizen};
      delete status[id]; delete notizen[id];
      return {...t, status, notizen};
    });
    try{ await db.collection("groups").doc(g.id).update({ personen, termine }); }
    catch(e){ toast("Fehler: " + e.message); }
  });
}

// ---------- Aktionen: Termine ----------
async function addTermin(g, termin){
  if(!isEditable()) return toast("Gruppe wird gerade von jemand anderem bearbeitet.");
  const termine = [...(g.termine||[]), { id: uid(), status:{}, notizen:{}, ...termin }];
  termine.sort((a,b)=> (b.datum||"").localeCompare(a.datum||"") || (b.startzeit||"").localeCompare(a.startzeit||""));
  try{ await db.collection("groups").doc(g.id).update({ termine }); }
  catch(e){ toast("Fehler: " + e.message); }
}
function deleteTermin(g, id){
  if(!isEditable()) return toast("Gruppe wird gerade von jemand anderem bearbeitet.");
  showConfirm("Diesen Termin wirklich löschen?", "Löschen", async ()=>{
    const termine = (g.termine||[]).filter(t=>t.id!==id);
    try{ await db.collection("groups").doc(g.id).update({ termine }); goto("group",{tab:"termine"}); }
    catch(e){ toast("Fehler: " + e.message); }
  });
}
async function setStatus(g, terminId, personId, status){
  if(!isEditable()) return toast("Gruppe wird gerade von jemand anderem bearbeitet.");
  const termine = (g.termine||[]).map(t => t.id===terminId ? {...t, status:{...t.status,[personId]:status}} : t);
  try{ await db.collection("groups").doc(g.id).update({ termine }); }
  catch(e){ toast("Fehler: " + e.message); }
}
async function setNote(g, terminId, personId, text){
  const termine = (g.termine||[]).map(t => t.id===terminId ? {...t, notizen:{...t.notizen,[personId]:text}} : t);
  try{ await db.collection("groups").doc(g.id).update({ termine }); }
  catch(e){ toast("Fehler: " + e.message); }
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
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${g.name}_export.csv`;
  a.click();
}

// ---------- Mitarbeiter / Einladungen ----------
async function inviteMitarbeiter(g, emailRaw){
  const email = emailRaw.trim().toLowerCase();
  if(!email || !email.includes("@")) return toast("Bitte gültige E-Mail eingeben.");
  if(g.members && g.members.some(uid => (g.memberInfo?.[uid]?.email||"").toLowerCase()===email)){
    return toast("Diese Person ist bereits Mitarbeiter.");
  }
  try{
    await db.collection("invites").doc(email).set({
      groupIds: firebase.firestore.FieldValue.arrayUnion(g.id),
      invitedBy: currentUser.email
    }, { merge: true });
    await db.collection("groups").doc(g.id).update({
      [`pendingInvites.${email}`]: { invitedAt: nowMs(), invitedBy: currentUser.email }
    });
    const actionCodeSettings = {
      url: window.location.origin + window.location.pathname.replace(/[^/]+$/, "") + "login.html",
      handleCodeInApp: true
    };
    await auth.sendSignInLinkToEmail(email, actionCodeSettings);
    toast("Einladung an " + email + " gesendet");
  }catch(e){
    toast("Fehler beim Einladen: " + e.message);
  }
}
async function removeMitarbeiter(g, memberUid){
  showConfirm("Diesen Mitarbeiter aus der Gruppe entfernen?", "Entfernen", async ()=>{
    try{
      await db.collection("groups").doc(g.id).update({
        members: firebase.firestore.FieldValue.arrayRemove(memberUid),
        [`memberInfo.${memberUid}`]: firebase.firestore.FieldValue.delete()
      });
      toast("Mitarbeiter entfernt");
    }catch(e){ toast("Fehler: " + e.message); }
  });
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

// ---------- Konto ----------
async function resendVerification(){
  try{ await currentUser.sendEmailVerification(); toast("Bestätigungs-E-Mail gesendet"); }
  catch(e){ toast("Fehler: " + e.message); }
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
        await doc.ref.update({
          members: firebase.firestore.FieldValue.arrayRemove(currentUser.uid),
          [`memberInfo.${currentUser.uid}`]: firebase.firestore.FieldValue.delete()
        });
      }
      await db.collection("users").doc(currentUser.uid).delete().catch(()=>{});
      await currentUser.delete();
      window.location.href = "login.html";
    }catch(e){
      if(e.code === "auth/requires-recent-login"){
        toast("Bitte melde dich ab und wieder an, dann versuche es erneut.");
      } else {
        toast("Fehler: " + e.message);
      }
    }
  });
}

// ---------- Modals ----------
function showModal(html, onOpen){
  const bg = document.createElement("div");
  bg.className = "modal-bg"; bg.id = "modalBg";
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

function modalNewPerson(){
  showModal(`<h3>Neue Person</h3>
    <div class="field-label">Name *</div>
    <input id="mPersonName" type="text" placeholder="Vor- und Nachname">
    <div class="field-label">E-Mail (optional)</div>
    <input id="mPersonEmail" type="email" placeholder="name@beispiel.de">
    <div class="field-label">Telefon (optional)</div>
    <input id="mPersonTel" type="tel" placeholder="+49 ...">
    <div class="field-label">Geburtstag (optional)</div>
    <input id="mPersonBday" type="date">
    <div class="field-label">Notiz (optional)</div>
    <input id="mPersonNote" type="text" placeholder="z. B. Allergien, Besonderheiten">
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="submitPerson()">Hinzufügen</button>
    </div>`, ()=>document.getElementById("mPersonName").focus());
}
function submitPerson(){
  const name = document.getElementById("mPersonName").value.trim();
  if(!name) return toast("Bitte einen Namen eingeben.");
  addPerson(currentGroup, {
    name,
    email: document.getElementById("mPersonEmail").value.trim(),
    telefon: document.getElementById("mPersonTel").value.trim(),
    geburtstag: document.getElementById("mPersonBday").value,
    notiz: document.getElementById("mPersonNote").value.trim()
  });
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
function submitInvite(){
  const email = document.getElementById("mInviteEmail").value;
  closeModal();
  inviteMitarbeiter(currentGroup, email);
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
    const groups = allMyGroups();
    app.innerHTML = groups.length ? groups.map(g=>`
      <div class="card" onclick="openGroup('${g.id}')">
        <div class="info"><b>${escapeHtml(g.name)}</b><span>${(g.personen||[]).length} Personen · ${(g.termine||[]).length} Termine ${isOwner(g)?"":"· Mitarbeiter"}</span></div>
        <span class="badge">›</span>
      </div>`).join("") : `<div class="empty">Noch keine Gruppen.<br>Tippe auf + um eine Gruppe anzulegen.</div>`;
    return;
  }

  if(nav.view==="konto"){
    title.textContent = "Mein Konto";
    fab.style.display = "none";
    const verified = currentUser.emailVerified;
    app.innerHTML = `
      <div class="account-card">
        <h3>${escapeHtml(currentUserData?.name || "")}</h3>
        <p>${escapeHtml(currentUser.email)}</p>
        <span class="verify-badge ${verified?'ok':'no'}">${verified? "✔ E-Mail bestätigt" : "⚠ E-Mail nicht bestätigt"}</span>
        ${!verified ? `<div><button class="btn btn-secondary" onclick="resendVerification()">Bestätigungs-E-Mail erneut senden</button></div>` : ""}
      </div>
      <div class="account-card">
        <h3>Passwort</h3>
        <p>Wir senden dir einen Link zum Ändern deines Passworts per E-Mail.</p>
        <button class="btn btn-secondary" onclick="selfPasswordReset()">Passwort ändern</button>
      </div>
      <div class="account-card">
        <h3 style="color:var(--abwesend)">Konto löschen</h3>
        <p>Löscht dein Konto sowie alle Gruppen, deren Ersteller du bist, unwiderruflich.</p>
        <button class="btn" style="background:var(--abwesend);color:#fff;" onclick="deleteAccount()">Konto endgültig löschen</button>
      </div>`;
    return;
  }

  const g = currentGroup;
  if((nav.view==="group" || nav.view==="termin") && !g){
    app.innerHTML = `<div class="empty">Lade Gruppe…</div>`;
    return;
  }

  if(nav.view==="group"){
    title.textContent = g.name;
    exportBtn.style.visibility = "visible";
    exportBtn.onclick = ()=>exportCSV(g);
    const owner = isOwner(g);
    const editable = isEditable();
    fab.onclick = nav.tab==="termine" ? modalNewTermin : (nav.tab==="personen" ? modalNewPerson : (nav.tab==="mitarbeiter" ? modalInvite : null));
    fab.style.display = (nav.tab==="statistik" || (!editable && nav.tab!=="mitarbeiter") || (nav.tab==="mitarbeiter" && !owner)) ? "none" : "block";

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
        <div class="row">
          <div class="name">${escapeHtml(p.name)}${p.email?`<small>${escapeHtml(p.email)}</small>`:''}${p.telefon?`<small>${escapeHtml(p.telefon)}</small>`:''}</div>
          ${editable ? `<span class="del" onclick="deletePerson(currentGroup,'${p.id}')">Entfernen</span>` : ""}
        </div>`).join("") : `<div class="empty">Noch keine Personen.<br>Tippe auf + um jemanden hinzuzufügen.</div>`;
    } else if(nav.tab==="mitarbeiter"){
      const members = g.members||[];
      const pending = Object.entries(g.pendingInvites||{});
      body = members.map(mUid=>{
        const info = (g.memberInfo||{})[mUid] || {};
        const own = mUid===g.ownerUid;
        return `<div class="mitarbeiter-row">
          <div class="m-info"><b>${escapeHtml(info.name||info.email||"Unbekannt")}</b><span>${escapeHtml(info.email||"")}</span></div>
          <div class="m-actions">
            <span class="pill ${own?'owner':''}">${own?"Ersteller":"Mitarbeiter"}</span>
            ${(owner && !own) ? `<button onclick="resetPasswordFor('${info.email}')">🔑 Reset</button>` : ""}
            ${(owner && !own) ? `<button class="danger" onclick="removeMitarbeiter(currentGroup,'${mUid}')">Entfernen</button>` : ""}
          </div>
        </div>`;
      }).join("") + pending.map(([email])=>`
        <div class="mitarbeiter-row">
          <div class="m-info"><b>${escapeHtml(email)}</b><span>Einladung ausstehend</span></div>
          <div class="m-actions">
            <span class="pill pending">Ausstehend</span>
            ${owner ? `<button class="danger" onclick="cancelInvite(currentGroup,'${email}')">Zurückziehen</button>` : ""}
          </div>
        </div>`).join("");
      if(!members.length && !pending.length) body = `<div class="empty">Noch keine Mitarbeiter.</div>`;
      if(!owner) body = `<div class="empty" style="padding-bottom:6px;">Nur der Ersteller kann Mitarbeiter verwalten.</div>` + body;
    } else if(nav.tab==="statistik"){
      const overall = groupOverallRate(g);
      body = `<div class="row" style="display:block;">
          <div class="name">Ø Anwesenheit der Gruppe</div>
          <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${overall}%"></div></div>
          <small style="color:var(--muted)">${overall}% · ${(g.termine||[]).length} Termine erfasst</small>
        </div>` +
        ((g.personen||[]).length ? g.personen.map(p=>{
          const r = rate(g, p.id);
          return `<div class="row" style="display:block;">
            <div class="name">${escapeHtml(p.name)}</div>
            <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${r}%"></div></div>
            <small style="color:var(--muted)">${r}% Anwesenheit</small>
          </div>`;
        }).join("") : `<div class="empty">Keine Personen vorhanden.</div>`);
    }

    app.innerHTML = `
      ${lockBanner}
      <div class="tabs">
        <div class="tab ${nav.tab==='termine'?'active':''}" onclick="goto('group',{tab:'termine'})">Termine</div>
        <div class="tab ${nav.tab==='personen'?'active':''}" onclick="goto('group',{tab:'personen'})">Personen</div>
        <div class="tab ${nav.tab==='mitarbeiter'?'active':''}" onclick="goto('group',{tab:'mitarbeiter'})">Team</div>
        <div class="tab ${nav.tab==='statistik'?'active':''}" onclick="goto('group',{tab:'statistik'})">Statistik</div>
      </div>
      ${body}
      ${(nav.tab==='termine' && owner) ? `<div class="empty" style="padding-top:6px;"><span class="del" style="color:var(--muted)" onclick="deleteGroup(currentGroup)">Gruppe löschen</span></div>` : ""}
    `;
    return;
  }

  if(nav.view==="termin"){
    const t = getTermin(g, nav.terminId);
    if(!t){ return goto("group",{tab:"termine"}); }
    title.textContent = t.bezeichnung + " · " + formatDatum(t.datum);
    fab.style.display = "none";
    const editable = isEditable();

    let lockBanner = "";
    if(g.editLock && g.editLock.uid !== currentUser.uid && (nowMs()-g.editLock.ts) < 25000){
      lockBanner = `<div class="lock-banner">🔒 Wird gerade von <b>${escapeHtml(g.editLock.name)}</b> bearbeitet – nur Ansicht möglich.</div>`;
    }

    app.innerHTML = lockBanner + ((g.personen||[]).length ? g.personen.map(p=>{
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
          </div>
        </div>
        <input class="note-input ${(t.notizen||{})[p.id]?'show':''} ${dis}" placeholder="Notiz..." value="${escapeHtml((t.notizen||{})[p.id]||'')}"
          onfocus="this.classList.add('show')"
          onchange="setNote(currentGroup,'${t.id}','${p.id}', this.value)">
      </div>`;
    }).join("") : `<div class="empty">Diese Gruppe hat noch keine Personen.</div>`)
    + (editable ? `<div class="empty" style="padding-top:10px;"><span class="del" onclick="deleteTermin(currentGroup,'${t.id}')">Termin löschen</span></div>` : "");
    return;
  }
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

document.getElementById("backBtn").addEventListener("click", ()=>{
  if(nav.view==="termin") goto("group",{tab:"termine"});
  else if(nav.view==="group" || nav.view==="konto") goto("groups");
});

// Regelmäßiges Re-Render, damit ein abgelaufenes Lock (Timeout) auch ohne
// neue Datenänderung rechtzeitig in der Anzeige aktualisiert wird.
setInterval(()=>{ if(nav.view==="group" || nav.view==="termin") render(); }, 5000);
