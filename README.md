# Anwesenheits Check – Setup (Version 3)

## Neu in dieser Version
- Eigener 6-stelliger Bestätigungscode nach der Registrierung (per E-Mail, schön gestaltet über EmailJS) –
  ohne Bestätigung kann die App nicht genutzt werden
- E-Mail-Adresse kann im Konto geändert werden – erfordert erneute Code-Bestätigung an die neue Adresse
- Dark Mode (umschaltbar & gespeichert in den Konto-Einstellungen)
- Automatische Aktualisierung alle 60 Sekunden, pausiert automatisch während man in ein Feld tippt,
  ein-/ausschaltbar über das kleine Uhr-Symbol unten links oder in den Konto-Einstellungen
- Grüner "Speichern"-Button zusätzlich zur automatischen Speicherung
- Personen-Felder erweitert: Roblox Name, Discord Name, Eintrittsdatum, Ausgebildet durch, Rolle (HR/FDL/TF)
- Status pro Termin zurücksetzbar ("nicht eingetragen")
- Gruppenübersicht: Suche nach Namen + Filter "Alle / Meine / Geteilte"
- Team-Mitglieder können im Nachhinein bearbeitet werden (Anzeigename)
- Verlaufsprotokoll ("Logs") pro Gruppe, nur für den Ersteller sichtbar

## 1. EmailJS einrichten (für schön gestaltete Bestätigungscode-E-Mails)
1. Kostenloses Konto auf https://www.emailjs.com erstellen
2. **Email Services** → E-Mail-Dienst hinzufügen (z. B. Gmail) → verbinden → Service-ID notieren
3. **Email Templates** → neues Template erstellen, Inhalt z. B.:

```html
<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;background:#F4F6F9;border-radius:16px;">
  <h2 style="color:#2E7DF7;margin-top:0;">Anwesenheits Check</h2>
  <p>Hallo {{to_name}},</p>
  <p>dein Bestätigungscode lautet:</p>
  <div style="background:#2E7DF7;color:#fff;font-size:28px;font-weight:bold;letter-spacing:8px;
    text-align:center;padding:16px;border-radius:12px;margin:20px 0;">{{code}}</div>
  <p style="color:#7B8794;font-size:13px;">Der Code ist 15 Minuten gültig. Falls du diese Anfrage nicht
  gestellt hast, kannst du diese E-Mail ignorieren.</p>
</div>
```

4. Als Template-Variablen `{{to_email}}`, `{{to_name}}`, `{{code}}` verwenden (im "An"-Feld des
   Templates `{{to_email}}` eintragen). Template-ID notieren.
5. **Account** → **General** → Public Key kopieren
6. Alle drei Werte in `emailjs-config.js` eintragen:
```js
const EMAILJS_PUBLIC_KEY   = "...";
const EMAILJS_SERVICE_ID   = "...";
const EMAILJS_TEMPLATE_VERIFY = "...";
```

> Hinweis: Mitarbeiter-Einladungen und Passwort-Reset laufen weiterhin über Firebase selbst
> (Anmeldelink bzw. Reset-Link) und nutzen daher Firebases Standard-E-Mail-Design, da Firebase
> diese E-Mails clientseitig ohne eigenes Template versendet.

## 2. Firebase-Projekt (bereits vorhanden)
Siehe vorherige Anleitung. `firebase-config.js` sollte bereits ausgefüllt sein.

## 3. Authentication
Build → Authentication → Sign-in-Methode:
1. **E-Mail/Passwort** aktivieren
2. **E-Mail-Link (kennwortlose Anmeldung)** aktivieren (für Mitarbeiter-Einladungen)

Authentication → Einstellungen → Autorisierte Domains → deine GitHub-Pages-Domain hinzufügen.

## 4. Firestore-Sicherheitsregeln
Kompletten Regel-Text ersetzen durch:

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

      match /logs/{logId} {
        allow read: if isSignedIn() && request.auth.uid == get(/databases/$(database)/documents/groups/$(groupId)).data.ownerUid;
        allow create: if isSignedIn();
        allow delete: if isSignedIn();
      }
    }

    match /users/{userId} {
      allow read, write: if isSignedIn() && request.auth.uid == userId;
    }

    match /invites/{email} {
      allow read: if isSignedIn() && request.auth.token.email == email;
      allow write: if isSignedIn();
    }

    match /emailVerifications/{userId} {
      allow read, write: if isSignedIn() && request.auth.uid == userId;
    }

    match /emailChangeRequests/{userId} {
      allow read, write: if isSignedIn() && request.auth.uid == userId;
    }
  }
}
```

## 5. Hochladen
Alle Dateien (inkl. `emailjs-config.js`) in den Root deines GitHub-Pages-Repos hochladen.

## 6. Impressum & Datenschutz ausfüllen
Alle `[...]`-Platzhalter in `impressum.html` / `datenschutz.html` ersetzen.

## Wichtiger Hinweis zu E-Mail-Zustellung
Wenn E-Mails (egal ob Firebase-Standard oder EmailJS) nicht ankommen:
- Spam-/Werbeordner prüfen
- Manche deutsche Anbieter (GMX, web.de, T-Online) filtern automatisierte Mails teils aggressiver –
  zum Testen am besten zuerst mit einer Gmail-Adresse probieren
- Bei EmailJS: im EmailJS-Dashboard unter "Email History" nachsehen, ob der Versand dort als
  erfolgreich oder fehlgeschlagen protokolliert wurde – das zeigt sofort, ob es an Firebase/EmailJS
  oder am E-Mail-Anbieter des Empfängers liegt

## 7. Log-Bereinigung (30 Tage)
Standardmäßig läuft die Bereinigung **automatisch clientseitig**: Sobald der Gruppen-Ersteller
den "Logs"-Tab öffnet, werden Einträge, die älter als 30 Tage sind, gelöscht. Das reicht für die
meisten Fälle, setzt aber voraus, dass irgendwann mal jemand den Tab öffnet.

**Optional – echtes Hintergrund-Löschen ganz ohne geöffnete App:**
Dafür liegt im Ordner `functions/` eine fertige Cloud Function bereit. Setup (benötigt Node.js
auf deinem Computer sowie den Blaze-Tarif in Firebase – bei dieser Nutzungsgröße praktisch kostenlos):

```
npm install -g firebase-tools
firebase login
firebase init functions   (im Projektordner, bestehenden "functions"-Ordner auswählen)
cd functions && npm install
firebase deploy --only functions
```

Danach läuft `cleanupOldLogs` einmal täglich automatisch im Hintergrund – unabhängig davon,
ob die App gerade geöffnet ist.

## Dateien
- `login.html` / `register.html` – Anmeldung, Registrierung (mit Code-Versand), Einladungs-Link-Anmeldung
- `index.html` + `app.js` – Hauptanwendung
- `firebase-config.js` – Firebase-Zugangsdaten
- `emailjs-config.js` – EmailJS-Zugangsdaten
- `style.css` – Design inkl. Dark Mode
- `impressum.html` / `datenschutz.html` – Rechtstexte
