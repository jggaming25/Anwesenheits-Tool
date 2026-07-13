// ==========================================================
// EmailJS Konfiguration
// ==========================================================
// EmailJS erlaubt den Versand schön gestalteter E-Mails direkt aus dem
// Browser heraus, ganz ohne eigenen Server. Kostenloses Konto auf
// https://www.emailjs.com erstellen.
//
// Anleitung siehe README.md, Abschnitt "EmailJS einrichten".
// ==========================================================
const EMAILJS_PUBLIC_KEY   = "DEIN_PUBLIC_KEY";
const EMAILJS_SERVICE_ID   = "service_6bd9q0v";
const EMAILJS_TEMPLATE_VERIFY = "DEIN_TEMPLATE_ID"; // Template für 6-stelligen Bestätigungscode

if(typeof emailjs !== "undefined"){
  emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
}

// Sendet den 6-stelligen Bestätigungscode per E-Mail
function sendVerificationEmail(toEmail, toName, code){
  return emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_VERIFY, {
    to_email: toEmail,
    to_name: toName || toEmail,
    code: code
  });
}
