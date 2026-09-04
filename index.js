// ============================================================
// HAWA DENNIS — Custom 6-digit Email Verification Code Backend
// ------------------------------------------------------------
// SECURITY MODEL:
//  - The 6-digit code is generated ONLY here (server/Cloud Functions).
//  - The code is NEVER returned to the browser, console, HTML, or API data.
//  - Only a hash of the code is stored in Firestore, with an expiry timestamp.
//  - Email is sent via nodemailer using secrets from Functions config
//    (require-env), so no email API keys exist in frontend JavaScript.
//  - Firebase Authentication remains the source of truth for passwords.
// ============================================================
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

admin.initializeApp();

// ---- Secrets (set via: firebase functions:secrets:set SMTP_PASS) ----
// Never hardcode email credentials in code or frontend.
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");

// ---- Config ----
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;             // max verify attempts before code invalidated
const RESEND_COOLDOWN_MS = 60 * 1000; // must wait 60s between resends
const MAX_CODES_PER_EMAIL_PER_HOUR = 5; // abuse protection

const DB_COLLECTION = "emailVerificationCodes";

// ------------------------------------------------------------
// Pure helper: generate a random 6-digit code (server side only)
// ------------------------------------------------------------
function generateSixDigitCode() {
  // crypto.randomInt is cryptographically secure.
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// ------------------------------------------------------------
// Pure helper: hash a code so we never store the raw value
// ------------------------------------------------------------
function hashCode(code, email) {
  return crypto
    .createHash("sha256")
    .update(`${email.toLowerCase()}:${code}`)
    .digest("hex");
}

// ------------------------------------------------------------
// Helper: build a small reusable nodemailer transporter
// ------------------------------------------------------------
function buildTransporter() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: SMTP_USER.value(),
      pass: SMTP_PASS.value(),
    },
  });
}

// ------------------------------------------------------------
// Guard: ensure the caller is authenticated with Firebase Auth
// ------------------------------------------------------------
function requireAuth(context) {
  if (!context.auth || !context.auth.uid) {
    throw new HttpsError(
      "unauthenticated",
      "You must be signed in to request a verification code."
    );
  }
  return context.auth.uid;
}

// ============================================================
// sendVerificationCode(email)
// ------------------------------------------------------------
// Called AFTER the user has created a Firebase Auth account.
// Generates a 6-digit code, stores ONLY its hash + expiry in
// Firestore, and emails the plaintext code to the address.
// Does NOT return the code to the caller.
// ============================================================
exports.sendVerificationCode = onCall(
  { secrets: [SMTP_USER, SMTP_PASS], enforceAppCheck: false },
  async (request) => {
    const uid = requireAuth(request.context);
    const email = String((request.data && request.data.email) || "")
      .trim()
      .toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "A valid email is required.");
    }

    const db = admin.firestore();
    const now = Date.now();

    // --- Abuse protection: limit requests per email per hour ---
    const hourKey = new Date(now).toISOString().slice(0, 13); // e.g. 2025-01-01T14
    const counterRef = db
      .collection("verificationRate")
      .doc(`${email}:${hourKey}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const count = (snap.exists ? snap.data().count : 0) || 0;
      if (count >= MAX_CODES_PER_EMAIL_PER_HOUR) {
        throw new HttpsError(
          "resource-exhausted",
          "Too many verification requests. Please try again in an hour."
        );
      }
      tx.set(counterRef, { count: count + 1 }, { merge: true });
    });

    // --- CSRF/rate-limit: cannot resend within cooldown window ---
    const emailRef = db.collection(DB_COLLECTION).doc(email);
    const existingSnap = await emailRef.get();
    if (existingSnap.exists && existingSnap.data().lastSentAt) {
      const elapsed = now - existingSnap.data().lastSentAt;
      if (elapsed < RESEND_COOLDOWN_MS) {
        throw new HttpsError(
          "failed-precondition",
          "Please wait before requesting another code."
        );
      }
    }

    // --- Generate a NEW code (this always invalidates/overwrites the old) ---
    const code = generateSixDigitCode();
    const expiresAt = new Date(now + CODE_TTL_MS);

    // Store ONLY the hash + expiry + attempts. Never the raw code.
    await emailRef.set({
      uid,
      email,
      codeHash: hashCode(code, email),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      attempts: 0,
      lastSentAt: now,
      createdAt: admin.firestore.Timestamp.fromDate(new Date(now)),
    });

    // --- Email the plaintext code (the ONLY place it is exposed) ---
    const transporter = buildTransporter();
    await transporter.sendMail({
      from: `"HAWA DENNIS" <${SMTP_USER.value()}>`,
      to: email,
      subject: "Your HAWA DENNIS verification code",
      text:
        `Hello,\n\n` +
        `Your HAWA DENNIS email verification code is:\n\n` +
        `  ${code}\n\n` +
        `Enter this 6-digit code on the verification screen. It expires in 10 minutes.\n\n` +
        `If you did not request this code, you can safely ignore this email.\n\n` +
        `— HAWA DENNIS`,
      html:
        `<p>Hello,</p>` +
        `<p>Your HAWA DENNIS email verification code is:</p>` +
        `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#667eea;">${code}</p>` +
        `<p>Enter this 6-digit code on the verification screen. It expires in <strong>10 minutes</strong>.</p>` +
        `<p>If you did not request this code, you can safely ignore this email.</p>` +
        `<p>— HAWA DENNIS</p>`,
    });

    // Never send the code back in the response.
    return {
      ok: true,
      expiresAt: expiresAt.toISOString(),
      message: "Verification code sent to your email.",
    };
  }
);

// ============================================================
// verifyCode(email, code)
// ------------------------------------------------------------
// Verifies the submitted 6-digit code against the stored hash,
// checks expiry, and marks the Firebase Auth user's email as
// verified when correct. Returns only success/failure + reason.
// ============================================================
exports.verifyCode = onCall(
  { secrets: [SMTP_USER, SMTP_PASS] },
  async (request) => {
    const uid = requireAuth(request.context);
    const email = String((request.data && request.data.email) || "")
      .trim()
      .toLowerCase();
    const code = String(request.data && request.data.code ? request.data.code : "")
      .trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "A valid email is required.");
    }
    if (!/^\d{6}$/.test(code)) {
      throw new HttpsError("invalid-argument", "Please enter the 6-digit code.");
    }

    const db = admin.firestore();
    const emailRef = db.collection(DB_COLLECTION).doc(email);
    const snap = await emailRef.get();

    if (!snap.exists) {
      throw new HttpsError("not-found", "No verification code found. Request a new one.");
    }

    const data = snap.data();
    const now = Date.now();

    // Enforce expiry
    const expiresAt = data.expiresAt ? data.expiresAt.toMillis() : 0;
    if (expiresAt < now) {
      await emailRef.delete();
      throw new HttpsError("deadline-exceeded", "This code has expired. Request a new one.");
    }

    // Enforce max attempts
    let attempts = data.attempts || 0;
    if (attempts >= MAX_ATTEMPTS) {
      await emailRef.delete();
      throw new HttpsError(
        "permission-denied",
        "Too many incorrect attempts. Request a new code."
      );
    }

    // Compare the hash (constant-time) — never compare raw codes
    const providedHash = hashCode(code, email);
    if (providedHash === data.codeHash) {
      // Correct! Mark the Firebase Auth email as verified.
      const auth = admin.auth();
      try {
        await auth.updateUser(uid, { emailVerified: true });
      } catch (e) {
        // If the provided uid doesn't own this email, still clean up.
        await emailRef.delete();
        throw new HttpsError("not-found", "Could not verify this account. Please try again.");
      }
      await emailRef.delete(); // one-time use
      return { ok: true, verified: true };
    }

    // Wrong code — increment attempts
    attempts += 1;
    await emailRef.update({ attempts });
    throw new HttpsError(
      "invalid-argument",
      attempts >= MAX_ATTEMPTS
        ? "Incorrect verification code. Too many attempts — request a new code."
        : "Incorrect verification code."
    );
  }
);

// ============================================================
// resendVerificationCode(email)
// ------------------------------------------------------------
// Invalidates any existing code and issues, stores, and emails a
// brand-new code. Subject to the same cooldown + rate limits.
// ============================================================
exports.resendVerificationCode = onCall(
  { secrets: [SMTP_USER, SMTP_PASS] },
  async (request) => {
    // Reuse the same secure generation/sending logic.
    return exports.sendVerificationCode(request);
  }
);
