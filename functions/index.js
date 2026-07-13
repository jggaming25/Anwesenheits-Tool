// ==========================================================
// OPTIONAL: Echte serverseitige Log-Bereinigung
// ==========================================================
// Läuft täglich automatisch über Firebase Cloud Functions – auch wenn
// niemand die App geöffnet hat. Benötigt den Blaze-Tarif (Pay-as-you-go),
// verursacht bei dieser Nutzungsgröße aber praktisch 0 € Kosten (freies Kontingent).
//
// Ohne diese Funktion läuft die Bereinigung bereits clientseitig automatisch,
// sobald der Gruppen-Ersteller den "Logs"-Tab öffnet – siehe app.js (cleanupOldLogs).
// Diese Cloud Function ist nur nötig, wenn die Bereinigung WIRKLICH unabhängig
// vom App-Öffnen laufen soll.
//
// Deployment: siehe README.md, Abschnitt "Optional: Cloud Function für Logs".
// ==========================================================

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

exports.cleanupOldLogs = functions.pubsub.schedule("every 24 hours").onRun(async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const db = admin.firestore();
  const groupsSnap = await db.collection("groups").get();

  let totalDeleted = 0;
  for (const groupDoc of groupsSnap.docs) {
    const logsSnap = await groupDoc.ref.collection("logs").where("ts", "<", cutoff).get();
    if (logsSnap.empty) continue;
    const batch = db.batch();
    logsSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    totalDeleted += logsSnap.size;
  }

  console.log(`Log-Bereinigung abgeschlossen: ${totalDeleted} alte Einträge gelöscht.`);
  return null;
});
