# HAWA DENNIS — Firebase Authentication + Custom 6-digit Email Verification Code

## Status: IMPLEMENTED (requires Cloud Functions deployment)

A custom 6-digit email verification code system has been built on top of Firebase
Authentication. The code is generated, stored, expired, and emailed ONLY on the
backend (Cloud Functions). Passwords are handled exclusively by Firebase Auth and
are never stored in this project.

## What was the registration bug?

`firebase-auth.js` never exported `firebaseAuth`. Every auth page did
`import { firebaseAuth } from './firebase-auth.js';`, which threw at module load,
so no form event listeners were ever attached — clicking "Create account" did
nothing. Fixed by adding `export { firebaseAuth };`.

## Tasks
- [x] Fix the missing `export { firebaseAuth }` in firebase-auth.js (root cause)
- [x] Add Cloud Functions callable helpers (send/verify/resend) to firebase-auth.js
- [x] Create functions/index.js — generate, hash, store, expire, email the 6-digit code
- [x] Create firestore.rules — deny browser access to verification-code documents
- [x] Create firebase.json — functions + firestore rules + hosting config
- [x] Create functions/package.json + README (deploy/setup instructions)
- [x] user-auth.html — confirm-password field, validation, verification-code screen,
      send/resend/verify logic, 60s resend cooldown, friendly Firebase errors
- [x] user-account.html — "Resend verification code" button when email not verified
- [x] verify-email.html — update messaging to 6-digit code flow
- [x] forgot-password.html — uses Firebase sendPasswordResetEmail (link)

## Firestore storage (server only)
- `emailVerificationCodes/{email}` — stores `codeHash` (sha256 of email:code),
  `expiresAt` (10 min), `attempts` (max 5), `lastSentAt`, `uid`, `email`.
- `verificationRate/{email:hour}` — abuse counter (max 5/hr).

## To finish (you must do)
1. `cd functions && npm install`
2. Enable Firebase Auth (Email/Password), Cloud Functions, Firestore in the console.
3. Set secrets: `firebase functions:secrets:set SMTP_USER` and `SMTP_PASS`
   (use a Gmail app password).
4. `firebase deploy --only functions,firestore`
5. If functions deploy to a region other than us-central1, update
   `FUNCTIONS_REGION` in firebase-auth.js.
