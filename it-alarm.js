// ==========================================================
// IT-Alarm / Zugriffssperre – angebunden an das MRB-Ticket-Tool
// ==========================================================
// Diese App prüft regelmäßig den öffentlichen Status-Endpunkt des
// MRB-Ticket-Tools. Löst der Inhaber dort den Lockdown bzw. den
// IT-Alarm aus, wird diese App sofort (auch hier) gesperrt bzw.
// zeigt einen Warn-Banner – ohne dass jemand eingreifen muss.
//
// Lockdown  -> Vollbild-Sperre: Die App ist blockiert (analog zur
//              Sperre für Bearbeiter im Ticket-System).
// IT-Alarm  -> Warnbanner oben mit optionaler Meldung (schließbar).
// ==========================================================

(function () {
  var MRB_STATUS_URL = "https://mrb-ticket-tool.onrender.com/api/status";
  var POLL_MS = 20000;

  var lockdownEl = null;
  var alarmEl = null;

  function makeEl(tag, className, html) {
    var d = document.createElement(tag);
    d.className = className;
    if (html != null) d.innerHTML = html;
    return d;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showLockdown(message) {
    if (lockdownEl) return;
    var text = message || "Der Zugriff wurde für alle Bearbeiter gesperrt. Der IT-Alarm ist aktiv.";
    lockdownEl = makeEl("div", "mrb-it-lockdown",
      '<div class="mrb-it-lockdown-card">' +
        '<div class="mrb-it-lockdown-icon">🚨</div>' +
        '<h2>Zugriff gesperrt</h2>' +
        "<p>" + escapeHtml(text) + "</p>" +
        '<p class="mrb-it-lockdown-sub">Die Sperrung gilt systemweit. Bitte wende dich an den Verantwortlichen.</p>' +
      "</div>");
    document.body.appendChild(lockdownEl);
    document.body.classList.add("mrb-it-locked");
  }

  function hideLockdown() {
    if (!lockdownEl) return;
    lockdownEl.remove();
    lockdownEl = null;
    document.body.classList.remove("mrb-it-locked");
  }

  function showAlarm(text) {
    if (alarmEl) return;
    var msg = text || "Aktuell findet eine IT-Wartung statt.";
    alarmEl = makeEl("div", "mrb-it-alarm-banner",
      "<span><b>⚠ IT-Alarm:</b> " + escapeHtml(msg) + "</span>" +
        '<button class="mrb-it-alarm-close" aria-label="Schließen">&times;</button>');
    alarmEl.querySelector(".mrb-it-alarm-close").addEventListener("click", function () {
      alarmEl.remove();
      alarmEl = null;
    });
    document.body.insertBefore(alarmEl, document.body.firstChild);
  }

  function hideAlarm() {
    if (!alarmEl) return;
    alarmEl.remove();
    alarmEl = null;
  }

  function handle(status) {
    if (!status) return;
    var lock = status.lockdown && status.lockdown.enabled;
    var alarm = status.itAlarm && status.itAlarm.active;
    if (lock) showLockdown(status.lockdown.message);
    else hideLockdown();
    if (alarm) showAlarm(status.itAlarm.text);
    else hideAlarm();
  }

  async function poll() {
    try {
      var r = await fetch(MRB_STATUS_URL, { cache: "no-store" });
      if (!r.ok) return;
      handle(await r.json());
    } catch (e) {
      // App nicht erreichbar => kein Sperr-Wissen, Zustand unverändert lassen.
    }
  }

  function init() {
    poll();
    setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) poll();
    });
    window.addEventListener("focus", poll);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
