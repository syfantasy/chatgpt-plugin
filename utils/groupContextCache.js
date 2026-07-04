import sqlite3 from 'sqlite3'
import path from 'path'
import { dataDir, formatTimeToBeiJing } from './common.js'

/**
 * 群聊上下文缓存 - 用于实现滑动窗口下的 prompt prefix cache 复用
 *
 * 原理：
 *   第N轮 QQ 返回 M1..M20，格式化后发给 LLM，同时存快照 {groupId: [M1..M20]}
 *   第N+1轮 QQ 返回 M5..M25
 *   → 快照中有 M1..M20，新消息 M5..M25 中 M5..M20 与快照重叠
 *   → 从快照取 M1..M4，与 M5..M25 拼接 → M1..M25
 *   → 发给 LLM 时，前 20 条 (M1..M20) 与上次完全一致 → prefix cache 命中
 */

class GroupContextCache {
  constructor () {
    this.db = null
    this.initialized = false
    this._initPromise = null
  }

  async _init () {
    if (this.initialized) return
    if (this._initPromise) return this._initPromise

    this._initPromise = new Promise((resolve, reject) => {
      const dbPath = path.join(dataDir, 'data.db')
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) return reject(err)
        this.db.run(`CREATE TABLE IF NOT EXISTS group_context_cache (
          groupId TEXT PRIMARY KEY,
          snapshot TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        )`, (err) => {
          if (err) return reject(err)
          this.initialized = true
          resolve()
        })
      })
    })
    return this._initPromise
  }

  /**
   * 获取群的上一次快照
   * @param {string} groupId
   * @returns {Promise<Array<{id: string, text: string}>|null>}
   */
  async getSnapshot (groupId) {
    await this._init()
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT snapshot FROM group_context_cache WHERE groupId = ?',
        [String(groupId)],
        (err, row) => {
          if (err) return reject(err)
          if (!row) return resolve(null)
          try {
            resolve(JSON.parse(row.snapshot))
          } catch {
            resolve(null)
          }
        }
      )
    })
  }

  /**
   * 保存快照
   * @param {string} groupId
   * @param {Array<{id: string, text: string}>} messages
   */
  async saveSnapshot (groupId, messages) {
    await this._init()
    const snapshot = JSON.stringify(messages)
    const now = Date.now()
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO group_context_cache (groupId, snapshot, updatedAt) VALUES (?, ?, ?)`,
        [String(groupId), snapshot, now],
        (err) => resolve()
      )
    })
  }

  /**
   * 清理过期快照 (超过指定毫秒未更新)
   * @param {number} maxAgeMs 默认 1 小时
   */
  async cleanup (maxAgeMs = 3600000) {
    await this._init()
    const cutoff = Date.now() - maxAgeMs
    return new Promise((resolve) => {
      this.db.run(
        'DELETE FROM group_context_cache WHERE updatedAt < ?',
        [cutoff],
        () => resolve()
      )
    })
  }
}

export const groupContextCache = new GroupContextCache()

/**
 * 格式化单条聊天消息为 prompt 行
 * @param {*} chat
 * @param {{groupContextTemplateMessage: string}} templates
 * @returns {{id: string, text: string}}
 */
export function formatChatMessage (chat, templates) {
  const sender = chat.sender || {}
  const id = String(chat.messageId || chat.seq || '')
  const text = templates.groupContextTemplateMessage
    .replace('${message.sender.card}', sender.card || '-')
    .replace('${message.sender.nickname}', sender.nickname || '-')
    .replace('${message.sender.user_id}', sender.user_id || '-')
    .replace('${message.sender.role}', sender.role || '-')
    .replace('${message.sender.title}', sender.title || '-')
    .replace('${message.time}', chat.time ? formatTimeToBeiJing(chat.time) : '-')
    .replace('${message.messageId}', id || '-')
    .replace('${message.raw_message}', chat.raw_message || '-')
  return { id, text }
}

/**
 * 构建群聊上下文的独立消息列表（带缓存对齐）
 *
 * 利用快照实现滑动窗口下的 prefix cache 复用：
 * - 首次调用：直接返回新消息，并存快照
 * - 后续调用：找到重叠部分，从快照补全前缀，使旧消息位置不变
 *
 * @param {*} e event
 * @param {number} length 消息条数
 * @param {{groupContextTemplatePrefix: string, groupContextTemplateMessage: string, groupContextTemplateSuffix: string}} templates
 * @param {function} getHistoryFn 获取聊天历史的函数 (e, length) => chats[]
 * @returns {Promise<{header: string, messages: Array<{id: string, text: string}>}>}
 */
export async function buildGroupContextMessages (e, length, templates, getHistoryFn) {
  const { groupContextTemplatePrefix = '', groupContextTemplateSuffix = '' } = templates
  const chats = await getHistoryFn(e, length)

  // 格式化每条消息
  const newMessages = chats
    .filter(chat => chat)
    .map(chat => formatChatMessage(chat, templates))
    .filter(m => m.id) // 必须有 messageId

  if (newMessages.length === 0) {
    return { header: '', messages: [] }
  }

  const groupId = String(e.group_id || e.group?.group_id || 'unknown')

  // 构建 header
  const header = groupContextTemplatePrefix
    .replace('${group.group_id}', groupId)
    .replace('${group.name}', e.group?.name || e.group_name || 'unknown')

  // 尝试用快照对齐
  const snapshot = await groupContextCache.getSnapshot(groupId)

  let allMessages
  if (!snapshot || snapshot.length === 0) {
    // 首次，没有快照，直接使用新消息
    allMessages = newMessages
  } else {
    // 在快照中找新消息第一条出现的位置（重叠起点）
    const snapshotIdMap = new Map(snapshot.map((m, i) => [m.id, i]))
    let overlapStartInSnapshot = -1
    let overlapStartInNew = -1

    for (let i = 0; i < newMessages.length; i++) {
      const idx = snapshotIdMap.get(newMessages[i].id)
      if (idx !== undefined) {
        overlapStartInSnapshot = idx
        overlapStartInNew = i
        break
      }
    }

    if (overlapStartInSnapshot < 0) {
      // 没有重叠（消息被清空或间隔太久），直接用新的
      allMessages = newMessages
    } else {
      // 有重叠：从快照取重叠之前的消息，与完整新消息拼接
      const prefixFromSnapshot = snapshot.slice(0, overlapStartInSnapshot)
      allMessages = [...prefixFromSnapshot, ...newMessages]
      logger.debug(
        `[GroupContext] cache alignment: snapshot=${snapshot.length}, new=${newMessages.length}, ` +
        `prepend=${prefixFromSnapshot.length}, total=${allMessages.length}, ` +
        `cached_ratio=${Math.round((allMessages.length - (newMessages.length - overlapStartInNew)) / allMessages.length * 100)}%`
      )
    }
  }

  // 保存新快照（只保存本轮 QQ 返回的消息，不含旧前缀）
  await groupContextCache.saveSnapshot(groupId, newMessages)

  return { header, messages: allMessages }
}
