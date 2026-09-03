// Genera un par de claves VAPID para Web Push.
//   node scripts/gen-vapid.mjs
// Requiere: npm install (web-push).

import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("\nPega estas variables en .env.local y en Vercel:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:tu-email@ejemplo.com\n");
