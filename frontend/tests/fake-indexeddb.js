// A small in-memory IndexedDB for the frontend tests, the one store.test.js builds, shared so
// new tests need not copy it: open with an upgrade whose event carries oldVersion, object stores
// with put/get/getAll/delete, transactions over one store or several, and requests that answer
// on a later microtask. One instance is one device's storage: load store.js again over it and
// the new page opens the same data.
"use strict";

class FakeRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
    this.onblocked = null;
  }

  succeedLater(result) {
    queueMicrotask(() => {
      this.result = result;
      if (this.onsuccess) {
        this.onsuccess({ target: this });
      }
    });
  }

  failLater(error) {
    queueMicrotask(() => {
      this.error = error;
      if (this.onerror) {
        this.onerror({ target: this });
      }
    });
  }
}

class FakeObjectStore {
  constructor(name, keyPath) {
    this.name = name;
    this.keyPath = keyPath;
    this.indexes = {};
    this.records = new Map();
    // The error the next request fails with, once; null to succeed.
    this.failNextWith = null;
  }

  createIndex(name, keyPath) {
    this.indexes[name] = keyPath;
  }

  put(record) {
    return this.request(() => {
      const key = record[this.keyPath];
      this.records.set(key, structuredClone(record));
      return key;
    });
  }

  get(key) {
    return this.request(() => structuredClone(this.records.get(key)));
  }

  getAll() {
    return this.request(() => Array.from(this.records.values(), (row) => structuredClone(row)));
  }

  delete(key) {
    return this.request(() => {
      this.records.delete(key);
      return undefined;
    });
  }

  request(action) {
    const request = new FakeRequest();
    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = null;
      request.failLater(error);
      return request;
    }
    request.succeedLater(action());
    return request;
  }
}

class FakeDatabase {
  constructor(name) {
    this.name = name;
    this.version = 0;
    this.stores = new Map();
    this.transactions = [];
    this.closed = false;
    this.onversionchange = null;
  }

  close() {
    this.closed = true;
  }

  // As a browser does, creating a store that exists throws, which would abort an upgrade.
  createObjectStore(name, options) {
    if (this.stores.has(name)) {
      throw new Error(`ConstraintError: an object store named ${name} already exists`);
    }
    const store = new FakeObjectStore(name, options.keyPath);
    this.stores.set(name, store);
    return store;
  }

  // `storeNames` is one name or a list of them; each must exist, as in a browser.
  transaction(storeNames, mode) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    names.forEach((name) => {
      if (!this.stores.has(name)) {
        throw new Error(`NotFoundError: no object store named ${name}`);
      }
    });
    this.transactions.push({ storeNames: names, mode });
    return {
      mode,
      objectStore: (name) => {
        if (!names.includes(name)) {
          throw new Error(`NotFoundError: ${name} is not in this transaction`);
        }
        return this.stores.get(name);
      },
    };
  }
}

class FakeIndexedDB {
  constructor() {
    this.databases = new Map();
    this.openCalls = [];
  }

  open(name, version) {
    this.openCalls.push({ name, version });
    const request = new FakeRequest();
    let db = this.databases.get(name);
    if (!db) {
      db = new FakeDatabase(name);
      this.databases.set(name, db);
    }
    const oldVersion = db.version;
    queueMicrotask(() => {
      request.result = db;
      if (oldVersion < version) {
        db.version = version;
        if (request.onupgradeneeded) {
          request.onupgradeneeded({ target: request, oldVersion, newVersion: version });
        }
      }
      if (request.onsuccess) {
        request.onsuccess({ target: request });
      }
    });
    return request;
  }

  // The object store `storeName` of the app's database, read directly by a test.
  store(storeName, databaseName = "speech-coach") {
    return this.databases.get(databaseName).stores.get(storeName);
  }
}

module.exports = { FakeIndexedDB };
