import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Command } from 'commander'

import { registerCallCommand } from './call.js'

async function runCall(t: test.TestContext, args: string[]) {
  const env = { ...process.env }
  Object.assign(process.env, {
    SOKU_TOKEN: 'test-token', SOKU_ORG_ID: 'test-org', SOKU_BRAND_ID: 'test-brand',
    SOKU_API_BASE: 'https://cli-call.invalid', SOKU_NO_KEYCHAIN: '1',
  })
  t.after(() => { process.env = env })
  const bodies: unknown[] = []
  t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  let output = ''
  t.mock.method(process.stdout, 'write', (chunk: string) => { output += chunk; return true })
  t.mock.method(process.stderr, 'write', (chunk: string) => { output += chunk; return true })
  const stopped = new Error('test exit')
  let code: unknown
  t.mock.method(process, 'exit', (value: unknown) => { code = value; throw stopped })
  const program = new Command().exitOverride()
  registerCallCommand(program)
  try {
    await program.parseAsync(['call', ...args], { from: 'user' })
    assert.fail('command must exit')
  } catch (err) {
    if (err !== stopped) throw err
  }
  return { bodies, code, output: JSON.parse(output) }
}

test('--payload @path reads the JSON payload from a file', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'soku-call-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'payload.json')
  writeFileSync(file, '{"platform":"meta","account_id":"act_1","name":"from file"}')
  const result = await runCall(t, ['ads', 'create_adset', '--payload', `@${file}`, '-p', 'name=override', '--summary', 'test'])
  assert.equal(result.code, 0)
  assert.deepEqual(result.bodies[0], { platform: 'meta', account_id: 'act_1', name: 'override', _summary: 'test' })
})

test('--payload @path names the file when it cannot be read', async (t) => {
  const result = await runCall(t, ['ads', 'create_adset', '--payload', '@/nonexistent/soku-payload.json'])
  assert.equal(result.bodies.length, 0)
  assert.equal(result.output.error.type, 'usage')
  assert.match(result.output.error.message, /soku-payload\.json/)
})

test('an inline --payload that is not JSON is still a usage error', async (t) => {
  const result = await runCall(t, ['ads', 'create_adset', '--payload', '{not json'])
  assert.equal(result.bodies.length, 0)
  assert.equal(result.output.error.type, 'usage')
})
