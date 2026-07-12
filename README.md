# Anwesenheits Check – Setup (Version 2)

## Neu in dieser Version
- Mitarbeiter per E-Mail einladen (Anmeldelink, automatische Registrierung/Anmeldung)
- Mitarbeiter können Anwesenheit genauso eintragen wie der Ersteller – nur solange sie in der Gruppe sind
- Live-Bearbeitungssperre: nur eine Person kann eine Gruppe gleichzeitig bearbeiten
- Passwort-Reset (durch Mitarbeiter selbst über den Login-Screen oder durch den Ersteller)
- E-Mail-Bestätigung nach der Registrierung
- Konto löschen
- Präzisere Termin-Felder (Uhrzeit von/bis, Ort, Beschreibung) und Personen-Felder (E-Mail, Telefon, Geburtstag, Notiz)
- Eigenes Bestätigungsfenster statt Browser-Popup beim Abmelden

## 1. Firebase-Projekt (bereits vorhanden)
Falls noch nicht geschehen: siehe vorherige Anleitung (Projekt erstellen, App registrieren, Config in `firebase-config.js`).

## 2. Authentication – zwei Anmeldemethoden aktivieren
Build → Authentication → Sign-in-Methode:
1. **E-Mail/Passwort** aktivieren (falls noch nicht geschehen)
2. Zusätzlich in derselben Zeile **"E-Mail-Link (kennwortlose Anmeldung)"** aktivieren
   – wird für die Mitarbeiter-Einladung benötigt

## 3. Autorisierte Domain hinzufügen
Authentication → Einstellungen (Settings) → Tab **"Autorisierte Domains"**
→ **"Domain hinzufügen"** → deine GitHub-Pages-Domain eintragen, z. B.:
```
jggaming25.github.io
```

## 4. Firestore-Sicherheitsregeln
Firestore-Database → Regeln, kompletten Text ersetzen durch:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function isOwner(g) { return isSignedIn() && request.auth.uid == g.ownerUid; }
    function isMember(g) { return isSignedIn() && request.auth.uid in g.members; }
    function isInvited(groupId) {
      return isSignedIn() &&
        exists(/databases/$(database)/documents/invites/$(request.auth.token.email)) &&
        groupId in get(/databases/$(database)/documents/invites/$(request.auth.token.email)).data.groupIds;
    }

    match /groups/{groupId} {
      allow read: if isOwner(resource.data) || isMember(resource.data) || isInvited(groupId);
      allow create: if isSignedIn();
      allow update: if isOwner(resource.data) || isMember(resource.data) || isInvited(groupId);
      allow delete: if isOwner(resource.data);
    }

    match /users/{userId} {
      allow read, write: if isSignedIn() && request.auth.uid == userId;
    }

    match /invites/{email} {
      allow read: if isSignedIn() && request.auth.token.email == email;
      allow write: if isSignedIn();
    }
  }
}
```

> Hinweis: Die Live-Bearbeitungssperre wird auf App-Ebene durchgesetzt (verhindert
> versehentliches gleichzeitiges Bearbeiten durch befreundete Nutzer), nicht als
> harte Sicherheitsgrenze in den Firestore-Regeln.

## 5. Hochladen
Alle Dateien in den Root deines GitHub-Pages-Repos hochladen (wie gehabt).

## 6. Impressum & Datenschutz ausfüllen
In `impressum.html` und `datenschutz.html` alle `[...]`-Platzhalter ersetzen.

## Funktionsweise Mitarbeiter-Einladung
1. Gruppen-Ersteller öffnet Gruppe → Tab "Team" → "+" → E-Mail eingeben
2. System sendet eine E-Mail mit Anmeldelink an diese Adresse
3. Empfänger klickt den Link:
   - Hat er schon ein Konto mit dieser E-Mail → wird direkt angemeldet
   - Hat er noch keins → wird automatisch registriert
4. Danach hat er sofort Zugriff auf die Gruppe und kann Anwesenheiten eintragen
5. Der Ersteller kann Mitarbeiter jederzeit wieder entfernen oder ihnen einen
   Passwort-Reset-Link senden (Tab "Team")

## Dateien
- `login.html` / `register.html` – Anmeldung, Registrierung, Einladungs-Link-Anmeldung
- `index.html` + `app.js` – Hauptanwendung (Gruppen, Termine, Personen, Team, Statistik, Konto)
- `firebase-config.js` – Zugangsdaten zu deinem Firebase-Projekt
- `style.css` – gemeinsames Design
- `impressum.html` / `datenschutz.html` – Rechtstexte
