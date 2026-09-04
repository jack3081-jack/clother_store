// ============================================================
// Firebase Authentication — HAWA DENNIS Clothing Store
// ============================================================
// This module initializes Firebase and exposes reusable auth
// helpers for the storefront. It is loaded from wh inline scripts
// on the auth pages (user-auth.html, user-account.html,
// forgot-password.html, verify-email.html) and from script.js.
// ============================================================

// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  deleteUser,
  currentUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD0db40j3MHiT4S1Zv_xe8nUbxVwP2yHfk",
  authDomain: "clothingstore-494ee.firebaseapp.com",
  projectId: "clothingstore-494ee",
  storageBucket: "clothingstore-494ee.firebasestorage.app",
  messagingSenderId: "606689531246",
  appId: "1:606689531246:web:24eb0b3fd606cf4706dd7f",
  measurementId: "G-2JE5QT2QY4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ------------------------------------------------------------
// Cloud Functions (callable) — the 6-digit verification code is
// generated, stored, expired, and emailed ONLY on the backend.
// The browser never sees the code — it only receives ok/failure.
// ------------------------------------------------------------
const FUNCTIONS_REGION = "us-central1"; // match your Functions region
const functions = getFunctions(app, FUNCTIONS_REGION);

// --- Enable this only when testing against the local emulator. ---
// connectFunctionsEmulator(functions, "localhost", 5001);

const sendVerificationCodeFn = httpsCallable(functions, "sendVerificationCode");
const verifyCodeFn = httpsCallable(functions, "verifyCode");
const resendVerificationCodeFn = httpsCallable(functions, "resendVerificationCode");

// ------------------------------------------------------------
// Auth UI helpers
// ------------------------------------------------------------

// Internal helper to display a message in a #msg element.
function showMsg(message, type = 'error') {
  const msg = document.getElementById('msg');
  if (!msg) return;
  msg.textContent = message;
  msg.className = type;
  msg.style.display = 'block';
}

// ------------------------------------------------------------
// Registration / Sign up
// ------------------------------------------------------------
async function firebaseRegister(email, password, name) {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  // Set the display name if provided
  if (name) {
    try {
      await updateProfile(user, { displayName: name });
    } catch (e) { /* ignore profile errors */ }
  }

// NOTE: The custom 6-digit verification code is sent by the backend
  // Cloud Function (sendVerificationCode), NOT by Firebase's standard
  // verification link. Passwords are never stored anywhere in this project.

  return user;
}

// ------------------------------------------------------------
// Custom 6-digit verification code (backend-managed)
// ------------------------------------------------------------

// Request a brand-new 6-digit code for the given email. The backend
// generates, hashes, stores, expires, and emails the code. It is never
// returned to this frontend.
async function firebaseSendVerificationCode(email) {
  const res = await sendVerificationCodeFn({ email });
  return (res && res.data) || {};
}

// Verify the 6-digit code the user typed. On success the backend marks
// the Firebase Auth account's email as verified. Never returns the code.
async function firebaseVerifyCode(email, code) {
  const res = await verifyCodeFn({ email, code });
  return (res && res.data) || {};
}

// Resend: the backend invalidates the previous code and issues a new one.
async function firebaseResendVerificationCode(email) {
  const res = await resendVerificationCodeFn({ email });
  return (res && res.data) || {};
}

// Reload the current user from Firebase Auth and report whether their
// email is now verified.
async function firebaseIsEmailVerified() {
  const user = auth.currentUser;
  if (!user) return false;
  await user.reload();
  return auth.currentUser && auth.currentUser.emailVerified === true;
}

// ------------------------------------------------------------
// Login / Sign in
// ------------------------------------------------------------
async function firebaseLogin(email, password) {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

// ------------------------------------------------------------
// Logout
// ------------------------------------------------------------
async function firebaseLogout() {
  await signOut(auth);
}

// ------------------------------------------------------------
// Password recovery / reset
// ------------------------------------------------------------
async function firebaseSendPasswordReset(email) {
  await sendPasswordResetEmail(auth, email);
}

// ------------------------------------------------------------
// Delete current account
// ------------------------------------------------------------
async function firebaseDeleteAccount() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not logged in');
  await deleteUser(user);
}

// ------------------------------------------------------------
// Auth state observer (check whether a user is logged in)
// ------------------------------------------------------------
function firebaseOnAuthStateChanged(callback) {
  return onAuthStateChanged(auth, callback);
}

function firebaseCurrentUser() {
  return auth.currentUser;
}

// Expose everything globally so inline scripts can use them.
window.firebaseAuth = {
  auth,
  register: firebaseRegister,
  login: firebaseLogin,
  logout: firebaseLogout,
  sendPasswordReset: firebaseSendPasswordReset,
  deleteAccount: firebaseDeleteAccount,
  onAuthStateChanged: firebaseOnAuthStateChanged,
  currentUser: firebaseCurrentUser,
  showMsg,
  // Custom 6-digit verification-code helpers
  sendVerificationCode: firebaseSendVerificationCode,
  verifyCode: firebaseVerifyCode,
  resendVerificationCode: firebaseResendVerificationCode,
  isEmailVerified: firebaseIsEmailVerified
};

// Let classic scripts (like script.js) know Firebase is ready so they can
// attach an auth-state listener for the header user-status display.
window.dispatchEvent(new Event('firebase:available'));

// Also expose the initialized app and config so other modules can reuse it
window.firebaseApp = app;
window.firebaseConfig = firebaseConfig;

// ------------------------------------------------------------
// CRITICAL: Named export so the auth pages' module imports work.
// The auth pages do:
//   import { firebaseAuth } from './firebase-auth.js';
// Without this export, the module throws and all form listeners
// never attach — which is exactly why account creation was failing.
// ------------------------------------------------------------
export { firebaseAuth };
