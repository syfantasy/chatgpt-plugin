import sqlite3 from 'sqlite3'
import path from 'path'
import fs from 'fs'

const runtimes = new Map()

function log (level, message, ...args) {
  const target = globalThis.logger?.[level]
  if (typeof target === 'function') target.call(globalThis.logger, message, ...args)
}

function normalizeCallArgs (params, callback) {
  if (typeof params === 'function') return { params: [], callback: params }
  return { params: params ?? [], callback: typeof callback === 'function' ? callback : () => {} }
}

function openNativeDatabase (dbPath, busyTimeout) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const db = new sqlite3.Database(dbPath, error => {
      if (error) return reject(error)
      db.configure('busyTimeout', busyTimeout)
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = ${busyTimeout};
      `, pragmaError => pragmaError ? reject(pragmaError) : resolve(db))
    })
  })
}

class DatabaseRuntime {
  constructor (dbPath, options = {}) {
    this.dbPath = path.resolve(dbPath)
    this.name = path.basename(this.dbPath)
    this.busyTimeout = options.busyTimeout ?? 5000
    this.slowQueryMs = options.slowQueryMs ?? 500
    this.refs = 0
    this.closing = false
    this.queues = { high: [], normal: [], low: [] }
    this.writerActive = false
    this.busyCount = 0
    this.writerReady = openNativeDatabase(this.dbPath, this.busyTimeout)
    this.readerReady = this.writerReady.then(() => openNativeDatabase(this.dbPath, this.busyTimeout))
    this.ready = Promise.all([this.writerReady, this.readerReady])
  }

  acquire () {
    if (this.closing) throw new Error(`SQLite runtime ${this.name} is closing`)
    this.refs++
    return new SQLiteDatabaseHandle(this)
  }

  enqueue (task, { priority = 'normal', label = 'write' } = {}) {
    const queuedAt = Date.now()
    return new Promise((resolve, reject) => {
      this.queues[priority]?.push({ task, label, queuedAt, resolve, reject }) ?? this.queues.normal.push({ task, label, queuedAt, resolve, reject })
      this.drain()
    })
  }

  async drain () {
    if (this.writerActive) return
    const item = this.queues.high.shift() || this.queues.normal.shift() || this.queues.low.shift()
    if (!item) return
    this.writerActive = true
    const waitMs = Date.now() - item.queuedAt
    if (waitMs >= this.slowQueryMs) log('warn', `[SQLite:${this.name}] writer wait ${waitMs}ms (${item.label}), queue=${this.queueDepth}`)
    const startedAt = Date.now()
    try {
      const db = await this.writerReady
      item.resolve(await item.task(db))
    } catch (error) {
      if (error?.code === 'SQLITE_BUSY') {
        this.busyCount++
        log('warn', `[SQLite:${this.name}] SQLITE_BUSY #${this.busyCount} (${item.label})`)
      }
      item.reject(error)
    } finally {
      const duration = Date.now() - startedAt
      if (duration >= this.slowQueryMs) log('warn', `[SQLite:${this.name}] slow write ${duration}ms (${item.label})`)
      this.writerActive = false
      queueMicrotask(() => this.drain())
    }
  }

  get queueDepth () {
    return this.queues.high.length + this.queues.normal.length + this.queues.low.length
  }

  async read (method, sql, params) {
    const db = await this.readerReady
    const startedAt = Date.now()
    try {
      return await new Promise((resolve, reject) => db[method](sql, params, (error, result) => error ? reject(error) : resolve(result)))
    } catch (error) {
      if (error?.code === 'SQLITE_BUSY') {
        this.busyCount++
        log('warn', `[SQLite:${this.name}] SQLITE_BUSY #${this.busyCount} (${method})`)
      }
      throw error
    } finally {
      const duration = Date.now() - startedAt
      if (duration >= this.slowQueryMs) log('warn', `[SQLite:${this.name}] slow ${method} ${duration}ms`)
    }
  }

  run (sql, params, options = {}) {
    return this.enqueue(db => new Promise((resolve, reject) => {
      db.run(sql, params, function (error) {
        if (error) reject(error)
        else resolve({ lastID: this.lastID, changes: this.changes })
      })
    }), { ...options, label: options.label || sql.trim().split(/\s+/, 2).join(' ') })
  }

  exec (sql, options = {}) {
    return this.enqueue(db => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve())), options)
  }

  transaction (work, options = {}) {
    return this.enqueue(async db => {
      const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) {
        if (error) reject(error)
        else resolve({ lastID: this.lastID, changes: this.changes })
      }))
      const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)))
      const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)))
      await run('BEGIN IMMEDIATE')
      try {
        const result = await work({ run, get, all })
        await run('COMMIT')
        return result
      } catch (error) {
        try { await run('ROLLBACK') } catch (rollbackError) { log('warn', `[SQLite:${this.name}] rollback failed: ${rollbackError.message}`) }
        throw error
      }
    }, { ...options, label: options.label || 'transaction' })
  }

  async release () {
    this.refs = Math.max(0, this.refs - 1)
    if (this.refs > 0 || this.closing) return
    this.closing = true
    while (this.writerActive || this.queueDepth > 0) await new Promise(resolve => setTimeout(resolve, 10))
    const writer = await this.writerReady
    const reader = await this.readerReady
    const startedAt = Date.now()
    await new Promise((resolve, reject) => reader.close(error => error ? reject(error) : resolve()))
    await new Promise((resolve, reject) => writer.run('PRAGMA wal_checkpoint(PASSIVE)', error => error ? reject(error) : resolve()))
    await new Promise((resolve, reject) => writer.close(error => error ? reject(error) : resolve()))
    runtimes.delete(this.dbPath)
    log('debug', `[SQLite:${this.name}] closed after checkpoint (${Date.now() - startedAt}ms)`)
  }
}

class SQLiteDatabaseHandle {
  constructor (runtime) {
    this.runtime = runtime
    this.ready = runtime.ready
  }

  run (sql, params, callback) {
    const args = normalizeCallArgs(params, callback)
    this.runtime.run(sql, args.params).then(result => args.callback.call(result, null), error => args.callback(error))
    return this
  }

  get (sql, params, callback) {
    const args = normalizeCallArgs(params, callback)
    this.runtime.read('get', sql, args.params).then(row => args.callback(null, row), error => args.callback(error))
    return this
  }

  all (sql, params, callback) {
    const args = normalizeCallArgs(params, callback)
    this.runtime.read('all', sql, args.params).then(rows => args.callback(null, rows), error => args.callback(error))
    return this
  }

  exec (sql, callback = () => {}) {
    this.runtime.exec(sql).then(() => callback(null), error => callback(error))
    return this
  }

  runAsync (sql, params = [], options = {}) { return this.runtime.run(sql, params, options) }
  getAsync (sql, params = []) { return this.runtime.read('get', sql, params) }
  allAsync (sql, params = []) { return this.runtime.read('all', sql, params) }
  execAsync (sql, options = {}) { return this.runtime.exec(sql, options) }
  transaction (work, options = {}) { return this.runtime.transaction(work, options) }
  serialize (callback) { callback(); return this }
  close (callback = () => {}) { this.runtime.release().then(() => callback(null), error => callback(error)); return this }
}

export function openSQLiteDatabase (dbPath, callback) {
  const resolvedPath = path.resolve(dbPath)
  let runtime = runtimes.get(resolvedPath)
  if (!runtime) {
    runtime = new DatabaseRuntime(resolvedPath)
    runtimes.set(resolvedPath, runtime)
  }
  const handle = runtime.acquire()
  if (typeof callback === 'function') runtime.ready.then(() => callback(null), callback)
  return handle
}

export async function closeAllSQLiteDatabases () {
  const active = [...runtimes.values()]
  for (const runtime of active) {
    runtime.refs = 1
    await runtime.release()
  }
}
