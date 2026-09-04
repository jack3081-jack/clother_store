// Firebase Firestore + Storage helpers
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, query, where, orderBy, onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

// IMPORTANT: firebase-auth.js already initializes the app with the same config.
// We re-use the same config here by reading the global firebase app if available.

let app;
try { app = window.firebaseApp; } catch (e) { /* ignore */ }

// If firebase-auth.js ran first it exposes the app via initializeApp, otherwise we create one here
// but in practice firebase-auth.js already runs on auth pages; this file should be imported after it.

// Attempt to initialize Firestore using the global app
function ensureApp() {
  if (app) return app;
  try {
    // eslint-disable-next-line no-undef
    app = initializeApp(window.firebaseConfig || {});
    return app;
  } catch (e) {
    console.warn('Firebase app already initialized or missing config');
    return app;
  }
}

ensureApp();

const db = getFirestore(app);
const storage = getStorage(app);

// Collections
const PRODUCTS = 'products';
const CATEGORIES = 'categories';
const ORDERS = 'orders';
const ADMINS = 'admins';

// Convert Firestore product doc to local product object
function fromDoc(docSnap) {
  const data = docSnap.data();
  return Object.assign({ id: docSnap.id }, data);
}

async function listProductsRealtime(onUpdate) {
  const q = query(collection(db, PRODUCTS), orderBy('createdAt', 'desc'));
  return onSnapshot(q, snapshot => {
    const items = [];
    snapshot.forEach(doc => items.push(fromDoc(doc)));
    onUpdate(items);
  });
}

async function getProductsOnce() {
  const q = query(collection(db, PRODUCTS), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  const items = [];
  snap.forEach(d => items.push(fromDoc(d)));
  return items;
}

async function addProduct(product) {
  const payload = Object.assign({}, product, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  const ref = await addDoc(collection(db, PRODUCTS), payload);
  const docSnap = await getDoc(ref);
  return fromDoc(docSnap);
}

async function updateProduct(productId, updates) {
  const ref = doc(db, PRODUCTS, productId);
  // fetch existing to handle storage lifecycle
  const existingSnap = await getDoc(ref);
  const existing = existingSnap.exists() ? existingSnap.data() : null;
  // if a new storagePath is provided and it differs from existing, delete the old image
  if (existing && updates && updates.storagePath && existing.storagePath && updates.storagePath !== existing.storagePath) {
    try { await deleteImage(existing.storagePath); } catch (e) { /* ignore */ }
  }
  await updateDoc(ref, Object.assign({}, updates, { updatedAt: serverTimestamp() }));
  const snap = await getDoc(ref);
  return fromDoc(snap);
}

async function deleteProductById(productId) {
  const ref = doc(db, PRODUCTS, productId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    if (data && data.storagePath) {
      try { await deleteImage(data.storagePath); } catch (e) { /* ignore */ }
    }
  }
  await deleteDoc(ref);
  return true;
}

// Categories: store as simple documents with id=slug and name
async function listCategories() {
  const snap = await getDocs(collection(db, CATEGORIES));
  const cats = [];
  snap.forEach(d => cats.push(Object.assign({ id: d.id }, d.data())));
  return cats;
}

async function addCategory(name) {
  const payload = { name, createdAt: serverTimestamp() };
  const ref = await addDoc(collection(db, CATEGORIES), payload);
  return { id: ref.id, name };
}

// Storage helpers
async function uploadImage(file, pathPrefix = 'products') {
  const id = Date.now();
  const path = `${pathPrefix}/${id}_${file.name}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file);
  const url = await getDownloadURL(ref);
  return { url, path };
}

async function deleteImage(path) {
  if (!path) return;
  try {
    const ref = storageRef(storage, path);
    await deleteObject(ref);
  } catch (e) { /* ignore errors */ }
}

// Orders
async function createOrder(order) {
  // Create order in a transaction: validate prices and stock, decrement stock atomically,
  // and write the order document. Throws on insufficient stock or missing product.
  return await runTransaction(db, async (tx) => {
    if (!order || !Array.isArray(order.items) || order.items.length === 0) throw new Error('Invalid order');
    let total = 0;
    const items = [];
    for (const it of order.items) {
      const prodRef = doc(db, PRODUCTS, String(it.id));
      const prodSnap = await tx.get(prodRef);
      if (!prodSnap.exists()) throw new Error(`Product ${it.id} not found`);
      const prod = prodSnap.data();
      const unitPrice = prod.price || 0;
      const qty = Number(it.qty) || 0;
      if ((prod.stock || 0) < qty) throw new Error(`Insufficient stock for ${prod.name || it.id}`);
      total += unitPrice * qty;
      items.push({ id: prodRef.id, name: prod.name || '', qty, unitPrice });
      // decrement stock
      tx.update(prodRef, { stock: (prod.stock || 0) - qty, updatedAt: serverTimestamp() });
    }

    const payload = Object.assign({}, order, { items, total, status: 'Pending', createdAt: serverTimestamp() });
    const orderRef = doc(collection(db, ORDERS));
    tx.set(orderRef, payload);
    return { id: orderRef.id, ...payload };
  });
}

async function listOrdersForAdmin() {
  const snap = await getDocs(collection(db, ORDERS));
  const items = [];
  snap.forEach(d => items.push(Object.assign({ id: d.id }, d.data())));
  return items;
}

// Admin helpers
async function isAdmin(uid) {
  if (!uid) return false;
  try {
    const adminRef = doc(db, ADMINS, uid);
    const snap = await getDoc(adminRef);
    return snap.exists();
  } catch (e) {
    return false;
  }
}

export const firebaseDB = {
  getProductsOnce,
  listProductsRealtime,
  addProduct,
  updateProduct,
  deleteProductById,
  listCategories,
  addCategory,
  uploadImage,
  deleteImage,
  createOrder,
  listOrdersForAdmin
  ,isAdmin
};

// Also expose globally for non-module scripts
window.firebaseDB = firebaseDB;
