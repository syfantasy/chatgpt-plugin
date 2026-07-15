import { asyncLocalStorage } from 'chaite'
import { readFile } from 'node:fs/promises'

function cleanMime (value, fallback = 'image/jpeg') {
  const mime = String(value || '').split(';')[0].trim().toLowerCase()
  return /^image\/[a-z0-9.+-]+$/.test(mime) ? mime : fallback
}

function mimeFromDataUrl (value, fallback = 'image/jpeg') {
  const match = /^data:([^;,]+)[;,]/i.exec(String(value || ''))
  return match ? cleanMime(match[1], fallback) : fallback
}

function sniffMime (buffer, fallback = 'image/jpeg') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return fallback
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return 'image/png'
  const head = buffer.toString('ascii', 0, Math.min(buffer.length, 12))
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  if (head.startsWith('BM')) return 'image/bmp'
  return fallback
}

function toDataUrl (base64, mimeType = 'image/jpeg') {
  return `data:${cleanMime(mimeType)};base64,${base64}`
}

function parseRefText (text) {
  const refs = []
  const re = /\[图片\s+ref:([^\]，,\s]+)[^\]]*\]/gi
  let match
  while ((match = re.exec(String(text || '')))) refs.push(match[1])
  return refs
}

function unwrap (value) {
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value
  return value.data_url || value.dataUrl || value.base64 || value.image || value.url || value.file || value.filePath || value.path || value.data || value
}

function probableRef (value) {
  if (typeof value !== 'string') return ''
  const text = value.trim().replace(/^ref:/i, '')
  if (!text || text.length > 256) return ''
  if (/^(?:data:|https?:\/\/|file:\/\/|\/|\.\/|\.\.\/)/i.test(text)) return ''
  return /^[a-z0-9_-]+$/i.test(text) ? text : ''
}

function normalizeValue (value, hintedMime) {
  value = unwrap(value)
  if (Buffer.isBuffer(value)) {
    const mimeType = sniffMime(value, cleanMime(hintedMime))
    return { buffer: value, dataUrl: toDataUrl(value.toString('base64'), mimeType), mimeType }
  }
  if (typeof value !== 'string') return null
  const input = value.trim()
  if (!input) return null
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(input)) {
    return { dataUrl: input, mimeType: mimeFromDataUrl(input, hintedMime) }
  }
  if (/^https?:\/\//i.test(input)) return { url: input, mimeType: cleanMime(hintedMime) }
  if (/^(?:file:\/\/|\/|\.\/|\.\.\/)/i.test(input)) {
    return { filePath: input.replace(/^file:\/\//i, ''), mimeType: cleanMime(hintedMime) }
  }
  const rawBase64 = input.replace(/^base64,/, '').replace(/\s+/g, '')
  if (rawBase64.length >= 32 && /^[a-z0-9+/=]+$/i.test(rawBase64)) {
    const mimeType = cleanMime(hintedMime)
    return { dataUrl: toDataUrl(rawBase64, mimeType), mimeType }
  }
  return null
}

function contentToInputs (content, source, out) {
  if (!Array.isArray(content)) return
  for (const item of content) {
    if (!item) continue
    if (item.type === 'text') {
      for (const ref of parseRefText(item.text)) out.push({ ref, source })
      continue
    }
    if (item.type !== 'image' && !item.image && !item.image_url && !item.data_url && !item.base64) continue
    const value = item.image ?? item.data_url ?? item.dataUrl ?? item.base64 ?? item.image_url?.url ?? item.url ?? item.file ?? item.path
    const normalized = normalizeValue(value, item.mimeType || item.mime_type)
    if (normalized || item.ref) out.push({ ...normalized, ref: item.ref, source })
  }
}

async function replyToInputs (event, out) {
  if (!event || (!event.source && !event.reply_id)) return
  try {
    let reply
    if (typeof event.getReply === 'function') reply = await event.getReply()
    else if (event.source && event.isGroup && event.group?.getChatHistory) reply = (await event.group.getChatHistory(event.source.seq, 1)).pop()
    else if (event.source && event.friend?.getChatHistory) reply = (await event.friend.getChatHistory(event.source.time, 1)).pop()
    contentToInputs(reply?.message, 'reply', out)
  } catch (error) {
    globalThis.logger?.warn?.('[image_context] 提取回复图片失败:', error?.message || error)
  }
}

function dedupe (inputs, max) {
  const result = []
  const seen = new Set()
  for (const input of inputs) {
    const key = input?.ref || input?.dataUrl || input?.url || input?.filePath
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(input)
    if (result.length >= max) break
  }
  return result
}

export function resolveImageInput (input, options = {}) {
  if (!input) return null
  const ref = typeof input === 'string'
    ? probableRef(input)
    : (typeof input.ref === 'string' ? input.ref.replace(/^ref:/i, '') : input.ref)
  if (ref && typeof options.resolveRef === 'function') {
    const resolved = options.resolveRef(ref)
    if (resolved) {
      const normalized = normalizeValue(resolved, resolved.mimeType || resolved.mime_type)
      return { ...resolved, ...normalized, ref: resolved.ref || ref, source: input.source || resolved.source }
    }
  }
  const normalized = normalizeValue(input, input?.mimeType || input?.mime_type)
  return normalized ? { ...normalized, ref: input?.ref, source: input?.source || 'argument' } : null
}

export async function collectImageInputs (options = {}) {
  const context = options.context || asyncLocalStorage.getStore()
  const event = options.event || context?.getEvent?.()
  const max = Math.max(1, Math.min(32, Number(options.max) || 12))
  const inputs = []

  contentToInputs(event?.message, 'event', inputs)
  if (Array.isArray(event?.img)) {
    for (const value of event.img) {
      const normalized = normalizeValue(value)
      if (normalized) inputs.push({ ...normalized, source: 'event.img' })
    }
  }
  await replyToInputs(event, inputs)

  if (options.includeHistory !== false && (!options.historyFallbackOnly || inputs.length === 0)) {
    const history = context?.getHistoryMessages?.() || []
    for (const message of history) contentToInputs(message?.content, 'history', inputs)
  }

  // @ 头像必须由调用方显式开启，避免把机器人头像或无关群友头像自动混入图片输入。
  if (options.includeAt === true && Array.isArray(event?.message)) {
    for (const item of event.message) {
      if (item?.type === 'at' && item.qq) {
        inputs.push({ url: `https://q1.qlogo.cn/g?b=qq&s=640&nk=${item.qq}`, mimeType: 'image/jpeg', source: 'at.avatar' })
      }
    }
  }

  return dedupe(inputs.map((input) => resolveImageInput(input, options) || input), max)
}

export async function imageToBuffer (input, options = {}) {
  const image = resolveImageInput(input, options)
  if (!image) throw new Error('图片输入为空或格式不受支持')
  if (image.buffer) return image.buffer
  if (image.dataUrl) return Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1), 'base64')
  if (image.filePath) return Buffer.from(await readFile(image.filePath))
  if (image.url) {
    const response = await fetch(image.url, { redirect: 'follow' })
    if (!response.ok) throw new Error(`获取图片失败: ${response.status} ${response.statusText}`)
    return Buffer.from(await response.arrayBuffer())
  }
  throw new Error('图片没有可读取的数据')
}

export async function imageToDataUrl (input, options = {}) {
  const image = resolveImageInput(input, options)
  if (!image) throw new Error('图片输入为空或格式不受支持')
  if (image.dataUrl) return image.dataUrl
  const buffer = await imageToBuffer(image, options)
  return toDataUrl(buffer.toString('base64'), sniffMime(buffer, image.mimeType))
}

export async function imageToInlineData (input, options = {}) {
  const image = resolveImageInput(input, options)
  if (!image) throw new Error('图片输入为空或格式不受支持')
  const buffer = await imageToBuffer(image, options)
  return { mime_type: sniffMime(buffer, cleanMime(image.mimeType)), data: buffer.toString('base64') }
}

// 兼容已有工具的导入方式；临时资源的实际生命周期由 visionService 管理。
export async function cleanupTemporaryImages (visionService, now = Date.now(), protectedRefs = []) {
  if (!visionService?.cleanupTemporaryImages) return 0
  return visionService.cleanupTemporaryImages(now, protectedRefs)
}

export async function registerTemporaryImage (record, visionService, options = {}) {
  if (!visionService?.registerTemporaryImage) return record
  return visionService.registerTemporaryImage(record, options)
}
