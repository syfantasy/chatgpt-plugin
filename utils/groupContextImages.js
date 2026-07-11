import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import fetch from 'node-fetch'
import { dataDir } from './common.js'
import { visionService } from './vision.js'

const CACHE_DIR = path.join(dataDir, 'images', 'group-context-compressed')

function normalizeConfig (vision = {}) {
  return {
    enabled: vision.enableGroupContextImageCompression === true,
    threshold: Math.max(0, Number(vision.groupContextImageCompressionThreshold) || 0),
    strategy: vision.groupContextImageCompressionStrategy === 'budget' ? 'budget' : 'fixed',
    scale: Math.min(100, Math.max(10, Number(vision.groupContextImageCompressionScale) || 70)),
    quality: Math.min(95, Math.max(20, Number(vision.groupContextImageCompressionQuality) || 75)),
    budget: Math.max(1024, Number(vision.groupContextImageCompressionBudget) || 3 * 1024 * 1024)
  }
}

function cachePath (source, scale, quality) {
  const sourceHash = crypto.createHash('sha256').update(source).digest('hex')
  return path.join(CACHE_DIR, `${sourceHash}-s${scale}-q${quality}.jpg`)
}

// Images are transmitted as base64, so use wire-size rather than raw file-size
// when enforcing the request budget.
function payloadSize (buffer) {
  return Math.ceil(buffer.length / 3) * 4
}

async function readSourceImage (image) {
  let cached = visionService.loadImage(image.ref)
  if (!cached) {
    const response = await fetch(image.url)
    if (!response.ok) throw new Error(`获取图片失败: ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const saved = visionService.saveImageFromBuffer(
      buffer,
      response.headers.get('content-type') || 'image/jpeg',
      image.ref,
      { url: image.url }
    )
    cached = { base64: buffer.toString('base64'), mimeType: saved.mimeType }
  }
  return {
    buffer: Buffer.from(cached.base64, 'base64'),
    mimeType: cached.mimeType || 'image/jpeg'
  }
}

async function compressImage (source, scale, quality) {
  const filePath = cachePath(source.buffer, scale, quality)
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath)

  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const metadata = await sharp(source.buffer, { animated: false }).metadata()
  const width = metadata.width ? Math.max(1, Math.floor(metadata.width * scale / 100)) : undefined
  const height = metadata.height ? Math.max(1, Math.floor(metadata.height * scale / 100)) : undefined
  const output = await sharp(source.buffer, { animated: false })
    .rotate()
    .resize({ width, height, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer()
  fs.writeFileSync(filePath, output)
  return output
}

async function optimizeOne (source, config, force = false, override = {}) {
  if (!config.enabled || (!force && source.buffer.length < config.threshold)) {
    return { buffer: source.buffer, mimeType: source.mimeType, compressed: false }
  }
  const scale = override.scale ?? config.scale
  const quality = override.quality ?? config.quality
  try {
    const buffer = await compressImage(source, scale, quality)
    // Don't turn an already efficient image into a larger payload.
    if (buffer.length >= source.buffer.length) {
      return { buffer: source.buffer, mimeType: source.mimeType, compressed: false }
    }
    return { buffer, mimeType: 'image/jpeg', compressed: true }
  } catch (error) {
    logger.warn(`[GroupContext] 图片压缩失败，使用原图: ${error.message}`)
    return { buffer: source.buffer, mimeType: source.mimeType, compressed: false }
  }
}

/**
 * Return model-ready image content for one group-context turn. Original image
 * files are kept untouched; compressed variants are content-addressed on disk.
 * @param {Array<{ref: string, url: string}>} images
 * @param {object} visionConfig
 */
export async function prepareGroupContextImages (images, visionConfig) {
  const config = normalizeConfig(visionConfig)
  const unique = [...new Map(images.filter(image => image?.ref && image?.url).map(image => [image.ref, image])).values()]
  const sourceByRef = new Map()
  for (const image of unique) {
    try {
      sourceByRef.set(image.ref, await readSourceImage(image))
    } catch (error) {
      logger.warn(`[GroupContext] 获取图片异常 ${image.url}: ${error.message}`)
    }
  }

  const resultByRef = new Map()
  for (const [ref, source] of sourceByRef) {
    resultByRef.set(ref, await optimizeOne(source, config))
  }

  if (config.enabled && config.strategy === 'budget') {
    let total = [...resultByRef.values()].reduce((sum, item) => sum + payloadSize(item.buffer), 0)
    // Re-encode the largest images with progressively more conservative
    // settings until the turn is within its payload budget where possible.
    for (const [ref, source] of [...sourceByRef.entries()].sort((a, b) => b[1].buffer.length - a[1].buffer.length)) {
      if (total <= config.budget) break
      const current = resultByRef.get(ref)
      const ratio = Math.max(0.2, Math.sqrt(config.budget / total))
      const candidate = await optimizeOne(source, config, true, {
        scale: Math.max(20, Math.floor(config.scale * ratio)),
        quality: Math.max(35, Math.floor(config.quality * ratio))
      })
      if (candidate.buffer.length < current.buffer.length) {
        total += payloadSize(candidate.buffer) - payloadSize(current.buffer)
        resultByRef.set(ref, candidate)
      }
    }
    if (total > config.budget) {
      logger.warn(`[GroupContext] 图片请求体约 ${total} bytes，仍超过预算 ${config.budget} bytes，已尽力压缩`)
    }
  }

  return new Map([...resultByRef.entries()].map(([ref, image]) => [ref, {
    type: 'image',
    image: image.buffer.toString('base64'),
    mimeType: image.mimeType,
    ref
  }]))
}
