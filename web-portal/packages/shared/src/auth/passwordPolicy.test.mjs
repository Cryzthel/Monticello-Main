/**
 * The password policy, checked against the mobile app's own rules.
 *
 * Run: node packages/shared/src/auth/passwordPolicy.test.mjs
 *
 * The symbol class is a long hand-copied character set, which is exactly the
 * kind of thing that looks right and is subtly wrong — a missing escape turns
 * a literal into a range and silently accepts or rejects a whole span of
 * characters. These cases pin the edges of it.
 */
import assert from 'node:assert/strict'
import process from 'node:process'
import { RULES, STRENGTH, meetsPolicy, passwordReady, scoreOf } from './passwordPolicy.js'

const cases = [
  // [password, meets policy?]
  ['Passw0rd!', true],
  ['abc', false], // too short, nothing else
  ['Password1', false], // no symbol
  ['password1!', true], // case is NOT checked at all any more — see RULES
  ['PASSWORD1!', true],
  ['Abcdefg1!', true], // exactly 9
  ['Abcdef1!', true], // exactly 8, the floor
  ['Abcde1!', false], // 7, one under
  // Every symbol in the Dart class, one at a time, on an otherwise valid stem.
  ...'!@#$%^&*(),.?":{}|<>_-\\/[]`~+=;'.split('').map((ch) => [`Abcdefg1${ch}`, true]),
  // Characters NOT in the class.
  ['Abcdefg1 ', false], // space
  ["Abcdefg1'", false], // apostrophe
]

let failures = 0
for (const [value, expected] of cases) {
  const got = meetsPolicy(value)
  if (got !== expected) {
    failures += 1
    console.error(`  meetsPolicy(${JSON.stringify(value)}) = ${got}, expected ${expected}`)
  }
}

// PASSWORD1! passes the four rules, so the label list must not imply otherwise.
assert.equal(RULES.length, 3)
assert.deepEqual(
  RULES.map((r) => r.label),
  ['At least 8 characters', 'At least one number', 'At least one special character'],
)

// Scoring: empty is -1, under length is the floor, all four is the top.
assert.equal(scoreOf(''), -1)
assert.equal(scoreOf('abc'), 0, 'under the length gate is the floor')
// The top tier has to be REACHABLE: every rule met must score Strong.
assert.equal(scoreOf('Abcdefg1!'), STRENGTH.length - 1, 'all rules met must be the top tier')
assert.equal(STRENGTH[scoreOf('Abcdefg1!')].label, 'Strong')
// Length only, then length + one more.
assert.equal(scoreOf('abcdefghij'), 1)
assert.equal(scoreOf('abcdefgh1'), 2)

// The submit gate demands every rule, not merely "not the weakest".
assert.equal(passwordReady('Password1', 'Password1'), false, 'no symbol must not submit')
assert.equal(passwordReady('Abcdefg!', 'Abcdefg!'), false, 'no number must not submit')
assert.equal(passwordReady('Abcdefg1!', 'Abcdefg1!'), true)
assert.equal(passwordReady('Abcdefg1!', 'Abcdefg1?'), false, 'mismatch must not submit')

if (failures) {
  console.error(`\n${failures} case(s) failed`)
  process.exit(1)
}
console.log(`passwordPolicy: ${cases.length} cases + 7 assertions passed`)
