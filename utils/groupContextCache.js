import sqlite3 from 'sqlite3'
import path from 'path'
import { visionService } from './vision.js'
import { dataDir, formatTimeToBeiJing } from './common.js'

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
      logger.debug(`[GroupContext] opening db at ${dbPath}`)
      this.db = new sqlite3.Database(dbPath, err => {
        if (err) return reject(err)
        this.db.run(`CREATE TABLE IF NOT EXISTS group_context_cache (
          groupId TEXT PRIMARY KEY,
          snapshot TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        )`, err => {
          if (err) return reject(err)
          this.initialized = true
          resolve()
        })
      })
    })
    return this._initPromise
  }

  /**
   * @param {string} groupId
   * @returns {Promise<Array<{id: string, text: string, images?: Array<{url: string}>}>|null>}
   */
  async getSnapshot (groupId) {
    await this._init()
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT snapshot FROM group_context_cache WHERE groupId = ?',
        [String(groupId)],
        (err, row) => {
          if (err) return reject(err)
          if (!row) {
            logger.debug(`[GroupContext] getSnapshot: no snapshot for group=${groupId}`)
            return resolve(null)
          }
          try {
            const msgs = JSON.parse(row.snapshot)
            logger.debug(`[GroupContext] getSnapshot ok: group=${groupId}, msgs=${msgs.length}`)
            resolve(msgs)
          } catch (e) {
            logger.error(`[GroupContext] getSnapshot parse error: ${e.message}`)
            resolve(null)
          }
        }
      )
    })
  }

  /**
   * @param {string} groupId
   * @param {Array<{id: string, text: string, images?: Array<{url: string}>}>} messages
   */
  async saveSnapshot (groupId, messages) {
    await this._init()
    const snapshot = JSON.stringify(messages)
    const now = Date.now()
    return new Promise(resolve => {
      this.db.run(
        'INSERT OR REPLACE INTO group_context_cache (groupId, snapshot, updatedAt) VALUES (?, ?, ?)',
        [String(groupId), snapshot, now],
        err => {
          if (err) logger.error(`[GroupContext] saveSnapshot failed: ${err.message}`)
          else logger.debug(`[GroupContext] saveSnapshot ok: group=${groupId}, msgs=${messages.length}, bytes=${snapshot.length}`)
          resolve()
        }
      )
    })
  }

  /**
   * @param {number} maxAgeMs
   */
  async cleanup (maxAgeMs = 3600000) {
    await this._init()
    const cutoff = Date.now() - maxAgeMs
    return new Promise(resolve => {
      this.db.run(
        'DELETE FROM group_context_cache WHERE updatedAt < ?',
        [cutoff],
        () => resolve()
      )
    })
  }
}

export const groupContextCache = new GroupContextCache()

function getMessageId (chat) {
  return String(chat.messageId || chat.message_id || chat.seq || chat.message_seq || '')
}

function extractMediaUrl (elem) {
  if (!elem || typeof elem !== 'object') return ''
  const data = elem.data || {}
  return elem.url ||
    elem.file_url ||
    elem.image_url ||
    elem.src ||
    data.url ||
    data.file_url ||
    data.image_url ||
    data.originUrl ||
    data.origin_url ||
    data.preview ||
    data.thumb ||
    data.bigUrl ||
    data.big_url ||
    data.src ||
    ''
}

function isImageLikeElem (elem) {
  return ['image', 'mface', 'bface', 'sface', 'marketface'].includes(elem?.type)
}

function imageRefText (ref) {
  return `[图片 ref:${ref}，可使用 ask_about_image 工具查看图片内容]`
}

async function buildImageRefs (chat) {
  const refs = []
  if (!Array.isArray(chat.message)) {
    if (chat.raw_message?.includes('[图片]') || chat.raw_message?.includes('[动画表情]')) {
      logger.debug(`[GroupContext] raw_message contains image marker but chat.message is not iterable: ${typeof chat.message}, isArray: ${Array.isArray(chat.message)}`)
    }
    return refs
  }

  for (const elem of chat.message) {
    if (!isImageLikeElem(elem)) continue
    const url = extractMediaUrl(elem)
    if (!url) {
      logger.debug(`[GroupContext] found image-like message but cannot extract URL: type=${elem.type}, keys=${JSON.stringify(Object.keys(elem))}, dataKeys=${elem.data ? JSON.stringify(Object.keys(elem.data)) : 'no data'}`)
      continue
    }

    try {
      const saved = await visionService.saveImage(url)
      refs.push(saved.ref)
    } catch (err) {
      logger.warn(`[GroupContext] failed to save history image ref from ${url}: ${err.message}`)
    }
  }
  return refs
}

/**
 * Format one group chat message. Images in history are represented only as
 * stable text refs, never as image content for the main conversation.
 *
 * @param {*} chat
 * @param {{groupContextTemplateMessage: string}} templates
 * @returns {Promise<{id: string, text: string, images: Array<{url: string}>}>}
 */
export async function formatChatMessage (chat, templates) {
  const sender = chat.sender || {}
  const id = getMessageId(chat)
  let rawMessage = chat.raw_message || '-'
  const refs = await buildImageRefs(chat)
  if (refs.length > 0) {
    rawMessage = `${rawMessage} ${refs.map(imageRefText).join(' ')}`
  }

  const text = templates.groupContextTemplateMessage
    .replace('${message.sender.card}', sender.card || '-')
    .replace('${message.sender.nickname}', sender.nickname || '-')
    .replace('${message.sender.user_id}', sender.user_id || '-')
    .replace('${message.sender.role}', sender.role || '-')
    .replace('${message.sender.title}', sender.title || '-')
    .replace('${message.time}', chat.time ? formatTimeToBeiJing(chat.time) : '-')
    .replace('${message.messageId}', id || '-')
    .replace('${message.raw_message}', rawMessage)

  return { id, text, images: [] }
}

/**
 * Build aligned group context messages for better prompt-cache reuse.
 *
 * @param {*} e event
 * @param {number} length
 * @param {{groupContextTemplatePrefix: string, groupContextTemplateMessage: string, groupContextTemplateSuffix: string}} templates
 * @param {function} getHistoryFn
 * @returns {Promise<{header: string, messages: Array<{id: string, text: string, images?: Array<{url: string}>}>}>}
 */
export async function buildGroupContextMessages (e, length, templates, getHistoryFn) {
  const { groupContextTemplatePrefix = '' } = templates
  const chats = await getHistoryFn(e, length)
  const groupId = String(e.group_id || e.group?.group_id || 'unknown')

  const snapshot = await groupContextCache.getSnapshot(groupId)
  const snapshotById = new Map((snapshot || []).map(m => [m.id, m]))

  const newMessages = []
  for (const chat of chats.filter(chat => chat)) {
    const id = getMessageId(chat)
    const cached = snapshotById.get(id)
    if (cached?.text?.includes('[图片 ref:')) {
      newMessages.push({ ...cached, images: [] })
      continue
    }

    const formatted = await formatChatMessage(chat, templates)
    if (formatted.id) newMessages.push(formatted)
  }

  if (newMessages.length === 0) {
    logger.debug(`[GroupContext] received ${chats?.length || 0} chats but no formatted messages; check messageId/seq compatibility`)
    return { header: '', messages: [] }
  }

  const header = groupContextTemplatePrefix
    .replace('${group.group_id}', groupId)
    .replace('${group.name}', e.group?.name || e.group_name || 'unknown')

  let allMessages
  if (!snapshot || snapshot.length === 0) {
    allMessages = newMessages
  } else {
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
      allMessages = newMessages
    } else {
      const prefixFromSnapshot = snapshot
        .slice(0, overlapStartInSnapshot)
        .map(m => ({ ...m, images: [] }))
      allMessages = [...prefixFromSnapshot, ...newMessages]
      logger.debug(
        `[GroupContext] cache alignment: snapshot=${snapshot.length}, new=${newMessages.length}, ` +
        `prepend=${prefixFromSnapshot.length}, total=${allMessages.length}, ` +
        `cached_ratio=${Math.round((allMessages.length - (newMessages.length - overlapStartInNew)) / allMessages.length * 100)}%`
      )
    }
  }

  const maxSnapshotMsgs = Math.min(length * 3, 100)
  if (allMessages.length > maxSnapshotMsgs) {
    allMessages = allMessages.slice(-maxSnapshotMsgs)
  }

  allMessages = allMessages.map(m => ({ ...m, images: [] }))
  await groupContextCache.saveSnapshot(groupId, allMessages)

  return { header, messages: allMessages }
}
