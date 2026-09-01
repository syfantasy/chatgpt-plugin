import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sqlite3 from 'sqlite3'
import { openSQLiteDatabase } from './runtime.js'
import { migrateSplitSQLiteDatabases } from './split_migrate.js'

function temporaryDirectory () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-plugin-sqlite-'))
}

function close (db) {
  return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()))
}

function openNative (dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, error => error ? reject(error) : resolve(db))
  })
}

test('shared runtime serializes concurrent writers and survives a released handle', async t => {
  const directory = temporaryDirectory()
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const dbPath = path.join(directory, 'data.db')
  const first = openSQLiteDatabase(dbPath)
  const second = openSQLiteDatabase(dbPath)
  await first.execAsync('CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT)')

  await Promise.all(Array.from({ length: 250 }, (_, index) => {
    const db = index % 2 ? first : second
    return db.runAsync('INSERT INTO entries(value) VALUES (?)', [`value-${index}`])
  }))
  await close(first)
  assert.equal((await second.getAsync('SELECT COUNT(*) AS count FROM entries')).count, 250)
  await close(second)
})

test('failed transaction rolls back and the writer queue continues', async t => {
  const directory = temporaryDirectory()
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const db = openSQLiteDatabase(path.join(directory, 'data.db'))
  await db.execAsync('CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT UNIQUE)')
  await assert.rejects(db.transaction(async transaction => {
    await transaction.run('INSERT INTO entries(value) VALUES (?)', ['duplicate'])
    await transaction.run('INSERT INTO entries(value) VALUES (?)', ['duplicate'])
  }))
  await db.runAsync('INSERT INTO entries(value) VALUES (?)', ['after-rollback'])
  assert.deepEqual(await db.allAsync('SELECT value FROM entries'), [{ value: 'after-rollback' }])
  await close(db)
})

test('busy timeout recovers after an external connection briefly holds the writer lock', async t => {
  const directory = temporaryDirectory()
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const dbPath = path.join(directory, 'data.db')
  const managed = openSQLiteDatabase(dbPath)
  await managed.execAsync('CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT)')
  const external = await openNative(dbPath)
  await new Promise((resolve, reject) => external.run('BEGIN IMMEDIATE', error => error ? reject(error) : resolve()))
  const pendingWrite = managed.runAsync('INSERT INTO entries(value) VALUES (?)', ['waited'])
  setTimeout(() => external.run('COMMIT'), 100)
  await pendingWrite
  assert.equal((await managed.getAsync('SELECT COUNT(*) AS count FROM entries')).count, 1)
  await close(managed)
  await new Promise((resolve, reject) => external.close(error => error ? reject(error) : resolve()))
})

test('legacy history and operation logs migrate idempotently into split databases', async t => {
  const directory = temporaryDirectory()
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const legacy = openSQLiteDatabase(path.join(directory, 'data.db'))
  await legacy.execAsync(`
    CREATE TABLE history (id TEXT PRIMARY KEY, parentId TEXT, conversationId TEXT, role TEXT, messageData TEXT, createdAt TEXT);
    CREATE TABLE operation_logs (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, type TEXT NOT NULL, level TEXT NOT NULL, userId TEXT, groupId TEXT, channelId TEXT, model TEXT, presetId TEXT, payload TEXT NOT NULL);
  `)
  await legacy.runAsync('INSERT INTO history VALUES (?,?,?,?,?,?)', ['h1', null, 'c1', 'user', '{}', 'now'])
  await legacy.runAsync('INSERT INTO operation_logs VALUES (?,?,?,?,?,?,?,?,?,?)', ['o1', 1, 'chat', 'info', 'u1', null, null, null, null, '{}'])
  await close(legacy)

  await migrateSplitSQLiteDatabases(directory, { batchSize: 1 })
  const legacyAfterDowngrade = openSQLiteDatabase(path.join(directory, 'data.db'))
  await legacyAfterDowngrade.runAsync('INSERT INTO history VALUES (?,?,?,?,?,?)', ['h2', 'h1', 'c1', 'assistant', '{}', 'later'])
  await legacyAfterDowngrade.runAsync('INSERT INTO operation_logs VALUES (?,?,?,?,?,?,?,?,?,?)', ['o2', 2, 'chat', 'info', 'u1', null, null, null, null, '{}'])
  await close(legacyAfterDowngrade)
  await migrateSplitSQLiteDatabases(directory, { batchSize: 1 })
  const history = openSQLiteDatabase(path.join(directory, 'history.db'))
  const operations = openSQLiteDatabase(path.join(directory, 'operation_logs.db'))
  assert.equal((await history.getAsync('SELECT COUNT(*) AS count FROM history')).count, 2)
  assert.equal((await operations.getAsync('SELECT COUNT(*) AS count FROM operation_logs')).count, 2)
  assert.equal((await legacyTableCount(directory, 'history')), 2)
  await Promise.all([close(history), close(operations)])
})

test('low-priority retention batches cooperate with foreground writes', async t => {
  const directory = temporaryDirectory()
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const db = openSQLiteDatabase(path.join(directory, 'operation_logs.db'))
  await db.execAsync('CREATE TABLE operation_logs (id INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL)')
  await db.transaction(async transaction => {
    for (let index = 0; index < 1200; index++) await transaction.run('INSERT INTO operation_logs(timestamp) VALUES (?)', [index])
  })
  let foregroundWrites = 0
  while ((await db.getAsync('SELECT COUNT(*) AS count FROM operation_logs')).count > 100) {
    await Promise.all([
      db.runAsync('DELETE FROM operation_logs WHERE id IN (SELECT id FROM operation_logs ORDER BY timestamp ASC LIMIT 200)', [], { priority: 'low', label: 'retention test batch' }),
      db.runAsync('INSERT INTO operation_logs(timestamp) VALUES (?)', [2000 + foregroundWrites], { priority: 'high', label: 'foreground test write' })
    ])
    foregroundWrites++
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(foregroundWrites > 1)
  assert.ok((await db.getAsync('SELECT COUNT(*) AS count FROM operation_logs')).count <= 100)
  await close(db)
})

test('stress: large retention sets prune incrementally while foreground writes continue', {
  skip: process.env.SQLITE_STRESS_TEST !== '1'
}, async t => {
  const directory = temporaryDirectory()
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const db = openSQLiteDatabase(path.join(directory, 'operation_logs.db'))
  const stressRows = Number.parseInt(process.env.SQLITE_STRESS_ROWS || '100000', 10)
  await db.execAsync('CREATE TABLE operation_logs (id INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL)')
  await db.transaction(async transaction => {
    for (let index = 0; index < stressRows; index++) await transaction.run('INSERT INTO operation_logs(timestamp) VALUES (?)', [index])
  }, { label: `seed ${stressRows} operation logs` })

  let foregroundWrites = 0
  while ((await db.getAsync('SELECT COUNT(*) AS count FROM operation_logs')).count > 1000) {
    await Promise.all([
      db.runAsync('DELETE FROM operation_logs WHERE id IN (SELECT id FROM operation_logs ORDER BY timestamp ASC LIMIT 1000)', [], { priority: 'low', label: '100k retention batch' }),
      db.runAsync('INSERT INTO operation_logs(timestamp) VALUES (?)', [200000 + foregroundWrites], { priority: 'high', label: 'foreground stress write' })
    ])
    foregroundWrites++
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(foregroundWrites >= Math.floor((stressRows - 1000) / 1000))
  await close(db)
})

async function legacyTableCount (directory, table) {
  const db = openSQLiteDatabase(path.join(directory, 'data.db'))
  try {
    return (await db.getAsync(`SELECT COUNT(*) AS count FROM ${table}`)).count
  } finally {
    await close(db)
  }
}
