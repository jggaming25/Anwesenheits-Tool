# Anwesenheits Check – Setup (HTML / GitHub Pages)

## 1. Firebase-Projekt einrichten
1. Auf https://console.firebase.google.com ein neues Projekt anlegen.
2. **Authentication** → Anmeldemethode → "E-Mail/Passwort" aktivieren.
3. **Firestore Database** → Datenbank erstellen (Produktivmodus).
4. Projekteinstellungen → "Meine Apps" → Web-App hinzufügen → Config kopieren.
5. Die kopierten Werte in `firebase-config.js` eintragen.

## 2. Firestore-Sicherheitsregeln
In der Firebase Console unter Firestore → Regeln:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 3. GitHub Pages
1. Neues Repo erstellen, alle Dateien in den Root hochladen (`index.html` muss im Root liegen).
2. Settings → Pages → Branch `main` → Save.
3. Aufrufbar unter `https://deinname.github.io/reponame`.

## 4. Impressum & Datenschutz ausfüllen
In `impressum.html` und `datenschutz.html` alle Platzhalter in eckigen Klammern
`[...]` durch echte Angaben ersetzen. Ein unvollständiges Impressum ist abmahnfähig.

## Dateien
- `login.html` / `register.html` – Anmeldung & Registrierung
- `index.html` + `app.js` – Hauptanwendung (Gruppen, Termine, Statistik)
- `firebase-config.js` – Zugangsdaten zu deinem Firebase-Projekt
- `style.css` – gemeinsames Design
- `impressum.html` / `datenschutz.html` – Rechtstexte
