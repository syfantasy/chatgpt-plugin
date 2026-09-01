import { ChaiteStorage } from 'chaite'
import { openSQLiteDatabase } from './runtime.js'

/** Durable storage for Chaite usage records. Indexed fields stay queryable by SQLite tools. */
export class SQLiteOperationLogStorage extends ChaiteStorage {
  constructor (dbPath, maxEntries = 50000) {
    super()
    this.db = openSQLiteDatabase(dbPath)
    this.writeCount = 0
    this.maxEntries = this.normalizeLimit(maxEntries)
    this.prunePromise = null
    this.pruneBatchSize = 500
  }

  getName () { return 'SQLiteOperationLogStorage' }

  initialize () {
    return new Promise((resolve, reject) => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS operation_logs (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          type TEXT NOT NULL,
          level TEXT NOT NULL,
          userId TEXT,
          groupId TEXT,
          channelId TEXT,
          model TEXT,
          presetId TEXT,
          payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_operation_logs_time ON operation_logs(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_operation_logs_user ON operation_logs(userId, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_operation_logs_group ON operation_logs(groupId, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_operation_logs_channel ON operation_logs(channelId, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_operation_logs_type ON operation_logs(type, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_operation_logs_retention ON operation_logs(timestamp ASC, id ASC);
      `, err => {
        if (err) return reject(err)
        resolve()
        this.schedulePrune()
      })
    })
  }

  getItem (id) {
    return new Promise((resolve, reject) => this.db.get('SELECT payload FROM operation_logs WHERE id = ?', [id], (err, row) => err ? reject(err) : resolve(row ? JSON.parse(row.payload) : null)))
  }

  setItem (id, value) {
    return new Promise((resolve, reject) => this.db.run(
      `INSERT OR REPLACE INTO operation_logs (id,timestamp,type,level,userId,groupId,channelId,model,presetId,payload) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, value.timestamp, value.type, value.level, value.userId, value.groupId, value.channelId, value.model, value.presetId, JSON.stringify(value)],
      err => {
        if (err) return reject(err)
        this.writeCount++
        // Keep low-spec hosts responsive: prune in small batches, scaled to the chosen limit.
        const pruneEvery = Math.min(200, Math.max(1, Math.floor(this.maxEntries / 10)))
        if (this.maxEntries > 0 && this.writeCount % pruneEvery === 0) {
          this.schedulePrune()
        }
        resolve(id)
      }
    ))
  }

  removeItem (id) { return new Promise((resolve, reject) => this.db.run('DELETE FROM operation_logs WHERE id = ?', [id], err => err ? reject(err) : resolve())) }
  async clear () {
    while (true) {
      const result = await this.db.runAsync(
        'DELETE FROM operation_logs WHERE id IN (SELECT id FROM operation_logs ORDER BY timestamp ASC, id ASC LIMIT ?)',
        [this.pruneBatchSize],
        { priority: 'low', label: 'clear operation logs batch' }
      )
      if (result.changes < this.pruneBatchSize) return
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  setMaxEntries (maxEntries) {
    this.maxEntries = this.normalizeLimit(maxEntries)
    return this.schedulePrune(true) || Promise.resolve()
  }
  normalizeLimit (value) {
    const limit = Number.parseInt(value, 10)
    return Number.isFinite(limit) && limit > 0 ? limit : 0
  }
  schedulePrune (force = false) {
    if (this.prunePromise) {
      return force ? this.prunePromise.then(() => this.schedulePrune(true)) : this.prunePromise
    }
    if (this.maxEntries <= 0) return null
    const targetEntries = this.maxEntries
    this.prunePromise = this.prune(targetEntries, force)
      .catch(error => globalThis.logger?.warn?.(`[SQLite:operation_logs.db] prune failed: ${error.message}`))
      .finally(() => { this.prunePromise = null })
    return this.prunePromise
  }
  async prune (targetEntries, force = false) {
    if (targetEntries <= 0) return
    const highWatermark = Math.max(targetEntries + 1, Math.ceil(targetEntries * 1.1))
    const row = await this.db.getAsync('SELECT COUNT(*) AS count FROM operation_logs')
    let remaining = Number(row?.count || 0)
    if (!force && remaining <= highWatermark) return
    while (remaining > targetEntries && this.maxEntries > 0) {
      const batchSize = Math.min(this.pruneBatchSize, remaining - targetEntries)
      const startedAt = Date.now()
      const result = await this.db.runAsync(
        'DELETE FROM operation_logs WHERE id IN (SELECT id FROM operation_logs ORDER BY timestamp ASC, id ASC LIMIT ?)',
        [batchSize],
        { priority: 'low', label: 'operation log retention batch' }
      )
      remaining -= result.changes
      globalThis.logger?.debug?.(`[SQLite:operation_logs.db] pruned ${result.changes} rows in ${Date.now() - startedAt}ms, remaining=${remaining}`)
      if (result.changes === 0) break
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  listItems () { return new Promise((resolve, reject) => this.db.all('SELECT payload FROM operation_logs ORDER BY timestamp DESC', (err, rows) => err ? reject(err) : resolve(rows.map(row => JSON.parse(row.payload))))) }
  async listItemsByEqFilter (filter) {
    const entries = Object.entries(filter)
    if (!entries.every(([field]) => FILTERABLE_COLUMNS.has(field))) {
      const items = await this.listItems()
      return items.filter(item => entries.every(([key, val]) => item[key] === val))
    }
    const where = entries.map(([field]) => `${field} = ?`).join(' AND ')
    const rows = await this.db.allAsync(`SELECT payload FROM operation_logs${where ? ` WHERE ${where}` : ''} ORDER BY timestamp DESC`, entries.map(([, value]) => value))
    return rows.map(row => JSON.parse(row.payload))
  }
  async listItemsByInQuery (query) {
    if (!query.every(({ field, values }) => FILTERABLE_COLUMNS.has(field) && Array.isArray(values))) {
      const items = await this.listItems()
      return items.filter(item => query.every(({ field, values }) => values.includes(item[field])))
    }
    if (query.some(({ values }) => values.length === 0)) return []
    const params = []
    const where = query.map(({ field, values }) => {
      params.push(...values)
      return `${field} IN (${values.map(() => '?').join(',')})`
    }).join(' AND ')
    const rows = await this.db.allAsync(`SELECT payload FROM operation_logs${where ? ` WHERE ${where}` : ''} ORDER BY timestamp DESC`, params)
    return rows.map(row => JSON.parse(row.payload))
  }
  async close () {
    await this.prunePromise
    await new Promise((resolve, reject) => this.db.close(error => error ? reject(error) : resolve()))
  }
}

const FILTERABLE_COLUMNS = new Set(['id', 'timestamp', 'type', 'level', 'userId', 'groupId', 'channelId', 'model', 'presetId'])
