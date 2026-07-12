// ==========================================================
// Firebase Konfiguration
// ==========================================================
// Hier deine eigenen Projekt-Zugangsdaten eintragen.
// Zu finden in der Firebase Console:
// Projekteinstellungen -> Allgemein -> "Meine Apps" -> SDK-Konfiguration
// ==========================================================
const firebaseConfig = {
  apiKey: "DEIN_API_KEY",
  authDomain: "DEIN_PROJEKT.firebaseapp.com",
  projectId: "DEIN_PROJEKT",
  storageBucket: "DEIN_PROJEKT.appspot.com",
  messagingSenderId: "DEINE_SENDER_ID",
  appId: "DEINE_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
