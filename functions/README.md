# HAWA DENNIS — Email Verification Code Backend

This folder contains Firebase Cloud Functions that generate, store, expire, and email
the 6-digit email verification code for new registrations.

## Why Cloud Functions?

The 6-digit code must NEVER be generated or inspected in the browser. All code
generation, hashing, storage, expiry, and emailing happens server-side in these
Functions. The browser only sees success/failure responses — never the code.

## What is deployed

| Function | Call mode | Purpose |
|----------|-----------|---------|
| `sendVerificationCode` | callable | Generate a new 6-digit code, store its SHA-256 hash + expiry in Firestore, email the code |
| `verifyCode` | callable | Compare submitted code against stored hash, check expiry/attempts, mark Firebase Auth email verified |
| `resendVerificationCode` | callable | Invalidate previous code, generate + email a brand-new code |

## Storage (Firestore)

Collection `emailVerificationCodes/{email}` stores ONLY:
- `uid` — Firebase Auth uid that requested the code
- `email` — normalized address
- `codeHash` — `sha256(email.toLowerCase() + ':' + code)` (never the raw code)
- `expiresAt` — 10 minutes after issuance
- `attempts` — running count of wrong entries (max 5)
- `lastSentAt` — used for the 60-second resend cooldown

Collection `verificationRate/{email:hour}` tracks how many codes were requested per
email per hour (max 5) to block abuse.

## Setup (one-time)

1. Create a Firebase project and enable **Authentication → Email/Password**, **Cloud
   Functions**, and **Cloud Firestore**.
2. `cd functions && npm install`
3. Add an app password for Gmail (Google Account → Security → 2-Step Verification →
   App passwords). Use that as `SMTP_PASS` — never your normal Gmail password.
4. Store the secrets in Firebase:
   ```
   firebase functions:secrets:set SMTP_USER
   firebase functions:secrets:set SMTP_PASS
   ```
5. `firebase deploy --only functions,firestore` (this deploys both the functions and
   the Firestore rules that deny browser access to the code documents).
6. In the Firebase Console → **Authentication → Templates**, the "Email verification"
   template is not used by this flow; the custom code email is sent by the Function
   instead. You may also set your **Action URL / sender name** under Authentication →
   Templates → Email address (used as the sender display name in the code email).

## Config needed in the frontend

`firebase-auth.js` must know the Region where the functions are deployed. By default
this code uses `us-central1` (the Functions default). If you deploy to another region,
update the `FUNCTIONS_REGION` constant in `firebase-auth.js`.

## Testing locally

```
firebase emulators:start --only functions
```

You will still need the `SMTP_USER`/`SMTP_PASS` secrets set, or provide them via a
local `.env` / emulator config so nodemailer can send mail during emulation.

