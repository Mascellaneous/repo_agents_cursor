/* =====================================================================
 * storage.js — IndexedDB 後端
 * ===================================================================== */
class IDB {
    constructor(name = 'SDGGGenEternalDB') {
        this.name = name; this.db = null; this._p = null;
    }
    init() {
        return new Promise((res, rej) => {
            const rq = indexedDB.open(this.name, 3);
            rq.onupgradeneeded = e => {
                const d = e.target.result;
                ['units', 'characters', 'supports', 'optionalParts', 'stages'].forEach(s => {
                    if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
                });
                if (!d.objectStoreNames.contains('metadata')) d.createObjectStore('metadata', { keyPath: 'key' });
            };
            rq.onsuccess = () => { this.db = rq.result; res(); };
            rq.onerror = () => rej(rq.error);
        });
    }
    ensure() { if (!this._p) this._p = this.init(); return this._p; }
    op(store, mode, fn) {
        return this.ensure().then(() => new Promise((res, rej) => {
            const t = this.db.transaction([store], mode);
            const rq = fn(t.objectStore(store));
            rq.onsuccess = () => res(rq.result);
            rq.onerror = () => rej(rq.error);
        }));
    }
    getAll(store)      { return this.op(store, 'readonly',  s => s.getAll()); }
    put(store, val)    { return this.op(store, 'readwrite', s => s.put(val)); }
    del(store, key)    { return this.op(store, 'readwrite', s => s.delete(key)); }
    clearStore(store)  { return this.op(store, 'readwrite', s => s.clear()); }
    bulkPut(store, arr){
        return this.ensure().then(() => new Promise((res, rej) => {
            const t = this.db.transaction([store], 'readwrite');
            const s = t.objectStore(store);
            arr.forEach(i => s.put(i));
            t.oncomplete = () => res(arr.length);
            t.onerror = () => rej(t.error);
        }));
    }
    getMeta(key)   { return this.op('metadata', 'readonly',  s => s.get(key)).then(r => r ? r.data : null); }
    putMeta(k, d)  { return this.op('metadata', 'readwrite', s => s.put({ key: k, data: d })); }
    metaEntries()  { return this.op('metadata', 'readonly',  s => s.getAll()); }
}
const db = new IDB();