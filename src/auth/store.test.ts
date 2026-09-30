import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'

import { clearToken, forgetRejectedToken, loadToken, saveToken } from './store.js'

let home: string
const origHome = process.env.HOME
const origToken = process.env.SOKU_TOKEN

const origNoKeychain = process.env.SOKU_NO_KEYCHAIN

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'soku-store-'))
  process.env.HOME = home
  delete process.env.SOKU_TOKEN
  // Force the file-fallback path so the test is deterministic regardless of
  // whether an OS keychain is available on the runner.
  process.env.SOKU_NO_KEYCHAIN = '1'
})

afterEach(() => {
  process.env.HOME = origHome
  if (origToken === undefined) delete process.env.SOKU_TOKEN
  else process.env.SOKU_TOKEN = origToken
  if (origNoKeychain === undefined) delete process.env.SOKU_NO_KEYCHAIN
  else process.env.SOKU_NO_KEYCHAIN = origNoKeychain
  rmSync(home, { recursive: true, force: true })
})

test('SOKU_TOKEN env overrides stored token', async () => {
  await saveToken('stored-token')
  process.env.SOKU_TOKEN = 'env-token'
  assert.equal(await loadToken(), 'env-token')
})

test('save → load round-trip via file fallback', async () => {
  // keytar is unavailable in CI/test, so this exercises the 0600 file path.
  await saveToken('file-token')
  assert.equal(await loadToken(), 'file-token')
})

test('credentials file is written with 0600 perms', async () => {
  await saveToken('secret')
  const path = join(home, '.soku', 'credentials.json')
  const mode = statSync(path).mode & 0o777
  assert.equal(mode, 0o600)
})

test('clearToken removes the stored token', async () => {
  await saveToken('to-clear')
  await clearToken()
  assert.equal(await loadToken(), null)
})

test('loadToken returns null when nothing stored', async () => {
  assert.equal(await loadToken(), null)
})

test('a rejected token clears the stored session it came from', async () => {
  await saveToken('stale-session')
  await forgetRejectedToken()
  assert.equal(await loadToken(), null)
})

test('a rejected SOKU_TOKEN leaves the stored session alone', async () => {
  // The env token only shadows the stored login. A bad CI key must not sign
  // the user out of the session they created with `soku auth login`.
  await saveToken('good-session')
  process.env.SOKU_TOKEN = 'revoked-key'
  await forgetRejectedToken()
  delete process.env.SOKU_TOKEN
  assert.equal(await loadToken(), 'good-session')
})
