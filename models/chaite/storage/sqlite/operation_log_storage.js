import { ChaiteStorage } from 'chaite'
import sqlite3 from 'sqlite3'

/** Durable storage for Chaite usage records. Indexed fields stay queryable by SQLite tools. */
export class SQLiteOperationLogStorage extends ChaiteStorage {
  constructor (dbPath) {
    super()
    this.db = new sqlite3.Database(dbPath)
    this.writeCount = 0
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
      `, err => err ? reject(err) : resolve())
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
        // Bound disk and query cost on small hosts. Prune in batches, not per write.
        if (this.writeCount % 200 === 0) {
          this.db.run('DELETE FROM operation_logs WHERE id NOT IN (SELECT id FROM operation_logs ORDER BY timestamp DESC LIMIT 50000)')
        }
        resolve(id)
      }
    ))
  }

  removeItem (id) { return new Promise((resolve, reject) => this.db.run('DELETE FROM operation_logs WHERE id = ?', [id], err => err ? reject(err) : resolve())) }
  clear () { return new Promise((resolve, reject) => this.db.run('DELETE FROM operation_logs', err => err ? reject(err) : resolve())) }
  listItems () { return new Promise((resolve, reject) => this.db.all('SELECT payload FROM operation_logs ORDER BY timestamp DESC', (err, rows) => err ? reject(err) : resolve(rows.map(row => JSON.parse(row.payload))))) }
  async listItemsByEqFilter (filter) { const items = await this.listItems(); return items.filter(item => Object.entries(filter).every(([key, val]) => item[key] === val)) }
  async listItemsByInQuery (query) { const items = await this.listItems(); return items.filter(item => query.every(({ field, values }) => values.includes(item[field]))) }
}
