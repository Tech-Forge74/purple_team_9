// Firestore backend. Loaded only when VITE_FIREBASE_* variables exist.
// Same record shapes as the local backend. Real-time sync with onSnapshot.

const COLLS = ['expenses', 'payments', 'claims']

export async function createFirebaseBackend(env) {
  const { initializeApp } = await import('firebase/app')
  const fs = await import('firebase/firestore')
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  })
  let store
  try {
    store = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    })
  } catch {
    store = fs.getFirestore(app)
  }

  const byTime = (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1)
  const qFor = (coll, groupId) => fs.query(fs.collection(store, coll), fs.where('groupId', '==', groupId))

  return {
    backend: 'firebase',

    subscribe(groupId, cb) {
      const state = { group: undefined, expenses: [], payments: [], claims: [] }
      const emit = () => {
        if (state.group === undefined) return
        cb({ group: state.group, expenses: [...state.expenses], payments: [...state.payments], claims: [...state.claims] })
      }
      const unsubs = [
        fs.onSnapshot(fs.doc(store, 'groups', groupId), (s) => { state.group = s.exists() ? s.data() : null; emit() }, () => { state.group = null; emit() }),
        ...COLLS.map((c) => fs.onSnapshot(qFor(c, groupId), (s) => {
          state[c] = s.docs.map((d) => d.data()).sort(byTime)
          emit()
        }, () => {})),
      ]
      return () => unsubs.forEach((u) => u())
    },

    async getSnapshot(groupId) {
      const g = await fs.getDoc(fs.doc(store, 'groups', groupId))
      const out = { group: g.exists() ? g.data() : null, expenses: [], payments: [], claims: [] }
      for (const c of COLLS) {
        const s = await fs.getDocs(qFor(c, groupId))
        out[c] = s.docs.map((d) => d.data()).sort(byTime)
      }
      return out
    },

    async getGroup(groupId) {
      const g = await fs.getDoc(fs.doc(store, 'groups', groupId))
      return g.exists() ? g.data() : null
    },

    async findGroupIdByCode(code) {
      const s = await fs.getDocs(fs.query(fs.collection(store, 'groups'), fs.where('inviteCode', '==', code), fs.limit(1)))
      return s.empty ? null : s.docs[0].id
    },

    async createGroup(group) {
      const ref = fs.doc(store, 'groups', group.id)
      await fs.runTransaction(store, async (tx) => {
        if ((await tx.get(ref)).exists()) throw new Error('exists')
        tx.set(ref, group)
      })
    },

    async mutateGroup(groupId, fn) {
      const ref = fs.doc(store, 'groups', groupId)
      return fs.runTransaction(store, async (tx) => {
        const s = await tx.get(ref)
        if (!s.exists()) throw Object.assign(new Error('Group not found.'), { userMessage: 'Group not found.' })
        const next = fn(structuredClone(s.data()))
        if (!next || next.id !== groupId) throw new Error('bad mutation')
        tx.set(ref, next)
        return next
      })
    },

    async create(coll, doc) {
      if (!COLLS.includes(coll)) throw new Error('bad collection')
      const ref = fs.doc(store, coll, doc.id)
      return fs.runTransaction(store, async (tx) => {
        if ((await tx.get(ref)).exists()) return 'exists'
        tx.set(ref, doc)
        return 'created'
      })
    },

    async update(coll, id, patch) {
      if (!COLLS.includes(coll)) throw new Error('bad collection')
      const { groupId: _ignored, ...rest } = patch
      await fs.updateDoc(fs.doc(store, coll, id), rest)
    },
  }
}
