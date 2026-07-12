// ==========================================================
// Firebase Konfiguration
// ==========================================================
// Hier deine eigenen Projekt-Zugangsdaten eintragen.
// Zu finden in der Firebase Console:
// Projekteinstellungen -> Allgemein -> "Meine Apps" -> SDK-Konfiguration
// ==========================================================
const firebaseConfig = {
  apiKey: "AIzaSyDy8Sb3ORMl4QSxPTGx87CvrJ4JoireL0I",
  authDomain: "anwesenheit-new.firebaseapp.com",
  projectId: "anwesenheit-new",
  storageBucket: "anwesenheit-new.firebasestorage.app",
  messagingSenderId: "279471737705",
  appId: "1:279471737705:web:03a02e821a73030808cbf8"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

