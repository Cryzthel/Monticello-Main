/**
 * When a laptop console restarts its Firestore stream.
 *
 *   node scripts/firestoreWake.test.mjs      (from apps/security-portal)
 *
 * installFirestoreWake (packages/shared/src/lib/firestoreWake.js) reconnects
 * once after sleep, a frozen tab, a bfcache restore or a returning network —
 * and never for a quick tab switch, and never leaves the console offline.
 */
import assert from 'assert'
import { installFirestoreWake, WAKE_AFTER_HIDDEN_MS } from '../../../packages/shared/src/lib/firestoreWake.js'

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

function target() {
  const handlers = {}
  return {
    handlers,
    visibilityState: 'visible',
    addEventListener: (type, fn) => ((handlers[type] ??= []).push(fn)),
    removeEventListener: (type, fn) => (handlers[type] = (handlers[type] ?? []).filter((h) => h !== fn)),
    fire(type, event = {}) {
      ;(handlers[type] ?? []).forEach((fn) => fn(event))
    },
  }
}
function rig({ disableThrows = false } = {}) {
  const doc = target()
  const win = target()
  let clock = 0
  const calls = []
  const uninstall = installFirestoreWake('db', {
    doc,
    win,
    now: () => clock,
    disable: async () => {
      calls.push('disable')
      if (disableThrows) throw new Error('boom')
    },
    enable: async () => calls.push('enable'),
  })
  const flush = () => new Promise((r) => setTimeout(r, 0))
  return { doc, win, calls, uninstall, flush, advance: (ms) => (clock += ms) }
}
const hideFor = async (r, ms) => {
  r.doc.visibilityState = 'hidden'
  r.doc.fire('visibilitychange')
  r.advance(ms)
  r.doc.visibilityState = 'visible'
  r.doc.fire('visibilitychange')
  await r.flush()
}

await check('a quick tab switch does not reconnect', async () => {
  const r = rig()
  await hideFor(r, WAKE_AFTER_HIDDEN_MS - 1)
  assert.deepStrictEqual(r.calls, [])
})
await check('coming back after the threshold reconnects once, disable then enable', async () => {
  const r = rig()
  await hideFor(r, WAKE_AFTER_HIDDEN_MS)
  assert.deepStrictEqual(r.calls, ['disable', 'enable'])
})
await check('resume, a bfcache restore and the network returning each reconnect', async () => {
  const r = rig()
  r.doc.fire('resume')
  await r.flush()
  r.win.fire('pageshow', { persisted: true })
  await r.flush()
  r.win.fire('pageshow', { persisted: false })
  await r.flush()
  r.win.fire('online')
  await r.flush()
  assert.deepStrictEqual(r.calls, ['disable', 'enable', 'disable', 'enable', 'disable', 'enable'])
})
await check('a burst of wake events reconnects once', async () => {
  const r = rig()
  r.win.fire('online')
  r.doc.fire('resume')
  r.win.fire('online')
  await r.flush()
  assert.deepStrictEqual(r.calls, ['disable', 'enable'])
})
await check('a failed disconnect still re-enables the network', async () => {
  const r = rig({ disableThrows: true })
  const warn = console.warn
  console.warn = () => {}
  r.win.fire('online')
  await r.flush()
  console.warn = warn
  assert.deepStrictEqual(r.calls, ['disable', 'enable'])
})
await check('uninstall removes every listener', async () => {
  const r = rig()
  r.uninstall()
  r.win.fire('online')
  r.doc.fire('resume')
  await hideFor(r, WAKE_AFTER_HIDDEN_MS * 2)
  assert.deepStrictEqual(r.calls, [])
})

await check('reconnect() restarts on demand, and shares the in-flight restart', async () => {
  const r = rig()
  const a = r.uninstall.reconnect('stuck-write')
  const b = r.uninstall.reconnect('stuck-write')
  assert.strictEqual(a, b)
  await a
  assert.deepStrictEqual(r.calls, ['disable', 'enable'])
})

console.log(`\n${passed} passed, ${process.exitCode ? 'failures above' : '0 failed'}`)
