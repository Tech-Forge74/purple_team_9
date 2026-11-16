// The only data module the app talks to. Two interchangeable backends:
// localStorage (default, zero setup) and Firestore (when VITE_FIREBASE_* exist).

import { local } from './db/local.js'

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}
const wantFirebase = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID)

let ready = null
function backend() {
  if (!wantFirebase) return Promise.resolve(local)
  if (!ready) {
    ready = import('./db/firebase.js')
      .then((m) => m.createFirebaseBackend(env))
      .catch(() => {
        console.error('Firebase unavailable, using this device only')
        return local
      })
  }
  return ready
}

const call = (name) => async (...args) => (await backend())[name](...args)

const db = {
  backend: wantFirebase ? 'firebase' : 'local',
  subscribe(groupId, cb) {
    let unsub = null
    let closed = false
    backend().then((b) => {
      if (!closed) unsub = b.subscribe(groupId, cb)
    })
    return () => { closed = true; if (unsub) unsub() }
  },
  getSnapshot: call('getSnapshot'),
  getGroup: call('getGroup'),
  findGroupIdByCode: call('findGroupIdByCode'),
  createGroup: call('createGroup'),
  mutateGroup: call('mutateGroup'),
  create: call('create'),
  update: call('update'),
}

export default db
