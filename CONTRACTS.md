# Internal contracts (shared by all builders)

Done already (do not rewrite, only fix real bugs): `src/validate.js`, `src/money.js`, `src/upi.js`, `src/ids.js`,
`src/ratelimit.js`, `src/engine/*` (split, nets, settle, ledger, demo, claims), `src/ai/*` (numbers, schema,
fallback, draft, bot, parse, chat), `api/_core.js`, `api/llm.js`.

## Data records (same in localStorage and Firestore). Money = integer paise.

```
group   { id, name, inviteCode, createdAt, demo: bool, creatorId,
          members: [{ id, name, upiId, tokenHash, devices: [deviceId], removed: bool, joinedAt }] }
expense { id, groupId, title, category, total, paidBy, mode, participants, splits, own?, source: 'form'|'ai',
          createdBy, createdAt, deleted: bool, deletedBy?, deletedAt? }
payment { id, groupId, from, to, amount, status: 'paid'|'confirmed'|'disputed'|'undone', claimId?,
          createdBy, createdAt, respondedAt? }
claim   { id, groupId, from (debtor), to (creditor), amount, status: 'requested'|'awaiting'|'closed',
          createdBy, createdAt, lastSentAt }
```
Raw member tokens are NEVER stored on the group: only `tokenHash = sha256(token)` (src/ids.js).

## `src/db.js` (owner: data agent) — default export `db`
Picks Firebase if `import.meta.env.VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_PROJECT_ID` exist, else local.
All methods async except subscribe. Collections: 'expenses' | 'payments' | 'claims'.
- `db.backend` -> 'local' | 'firebase'
- `db.subscribe(groupId, cb) -> unsubscribe`; cb({ group, expenses: [], payments: [], claims: [] }) on every change
  (local backend also listens to the `storage` event, so two tabs sync live). group null if missing.
- `db.getSnapshot(groupId) -> { group, expenses, payments, claims }` (fresh read, used by stale-screen guard)
- `db.getGroup(groupId) -> group | null`
- `db.findGroupIdByCode(code) -> groupId | null`
- `db.createGroup(group) -> void`
- `db.mutateGroup(groupId, fn) -> newGroup` ; fn(group) returns new group or throws Error(userMessage). Atomic (transaction on Firestore).
- `db.create(coll, doc) -> 'created' | 'exists'` ; idempotent by doc.id (double tap = one record)
- `db.update(coll, id, patch) -> void`

## `src/session.js` (owner: data agent)
- `getDeviceId()` random, persisted
- `getSession(groupId) -> { memberId, token, creator: bool, actingAs?: memberId } | null`
- `setSession(groupId, s)`, `clearSession(groupId)`
- `getCurrentGroupId()`, `setCurrentGroupId(id|null)`
- `listMyGroups() -> [{ id, name }]`, `rememberGroup(id, name)`
- `saveCreatorToken(groupId, memberId, token)`, `getCreatorTokens(groupId) -> { memberId: token }`
- `dismissedDeviceBanner(groupId)`, `dismissDeviceBanner(groupId)`

## `src/actions.js` (owner: data agent). Every action validates, re-checks invariants, fails closed.
All return `{ ok: true, ... } | { ok: false, error: 'plain message' }`. Never throw. `me` = acting member id.
- `createGroup({ groupName, name, upiId }) -> { ok, groupId }` (sets session as creator)
- `loadDemoGroup() -> { ok, groupId }` (demo: true, session = Ankit, creator: true, tokens saved for all)
- `joinGroup({ code, name, upiId }) -> { ok, groupId }` (rate limited with failureGate, unique name: "Ravi 2")
- `addMemberByCreator(groupId, { name, upiId }) -> { ok, memberId, token }`
- `openPersonalLink(groupId, token) -> { ok, groupId, newDevice: bool }` (rate limited; invalid -> generic error)
- `verifySession(groupId, group) -> { ok, me, realMe, canSwitch } ` (sync, uses a cached hash; see below) —
  implemented as `async verifySessionAsync(groupId)`; App calls it on load.
- `switchMember(groupId, memberId)` (only if group.demo or session.creator)
- `reissueToken(groupId, me, memberId) -> { ok, token }` (creator or the member themself)
- `regenerateInviteCode(groupId, me) -> { ok, code }` (creator only)
- `removeMember(groupId, me, memberId, ledger)` (creator only; blocked if net != 0)
- `saveExpense(groupId, me, form) -> { ok }` form = { id, title, category, total, paidBy, mode, participants, own, custom, source }
  re-runs validateTitle, computeSplit (poster = me), membership, 500-expense cap, checkWrite invariants.
- `deleteExpense(groupId, me, expenseId)` soft, only creator of the expense
- `recordPayment(groupId, me, { id, from, to, amount, claimId?, expectedAmount })` -> re-reads snapshot; if
  owedBetween now != expectedAmount -> `{ ok:false, stale:true, error:'Balances changed. Review before paying' }`
- `undoPayment(groupId, me, paymentId)` (canUndo)
- `respondPayment(groupId, me, paymentId, received: bool)` -> confirmed (closes claim) | disputed (claim back to requested)
- `sendClaim(groupId, me, { from }) -> { ok, claim, message, link }` message from fixed template, link from buildUpiLink
- `checkFreshPay(groupId, from, to, expectedAmount) -> { ok, stale? }` for the Pay button

## `src/store.js` (owner: data agent)
`useGroup(groupId) -> { data, ledger, loading, me, realMe, canSwitch, isCreator, nameOf, memberOf }`
(data = db snapshot; ledger = buildLedger(data); nameOf(id) -> member name or 'Unknown').

## `src/components/ui.jsx` (owner: shell agent)
Named exports: `Avatar({ name, size })`, `Card`, `Button({ variant: 'primary'|'ghost'|'danger'|'success', busy, ...})`,
`ErrorBanner({ text })`, `Sheet({ open, onClose, title, children })`, `ToastProvider`, `useToast() -> { show(text, { action?: {label, onClick}, ms? }) }`,
`QRImage({ text, size })` (uses `qrcode` toDataURL, no network), `CopyButton({ text, label })`, `Empty({ title, hint })`, `Tabs({ tabs, value, onChange })`.
Tailwind v4 classes. Indigo brand, red owe, green owed, purple treat, rounded-2xl, 44px tap targets.

## Screens (props)
- `Landing({ onOpenGroup(groupId), joinCode })` — shell agent
- `GroupHome({ groupId, onAdd(), onSettle(), onLeave() })` — group agent
- `AddExpense({ groupId, prefill?, onDone() })` — add agent (Chat + Form tabs)
- `SettleUp({ groupId })` — group agent
App (shell agent) routes: landing | group (bottom nav Home / Add / Settle) | invalid-link screen.
All user text rendered as plain React text. Never dangerouslySetInnerHTML.
