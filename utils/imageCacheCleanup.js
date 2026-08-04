import fs from 'node:fs'
import path from 'node:path'

const IMAGE_FILE_RE = /^([a-f0-9]{32})\.(jpg|png|gif|webp)$/i

export const IMAGE_RETENTION_PRESETS = Object.freeze({
  forever: 0,
  '30d': 30 * 24,
  '7d': 7 * 24,
  '3d': 3 * 24,
  '1d': 24
})

export function resolveImageRetentionMs (config = {}) {
  const preset = String(config.imageRetentionPreset || 'forever')
  const presetHours = IMAGE_RETENTION_PRESETS[preset]
  if (presetHours !== undefined) {
    return presetHours > 0 ? presetHours * 60 * 60 * 1000 : 0
  }

  if (preset !== 'custom') return 0
  const customHours = Number(config.imageRetentionCustomHours)
  if (!Number.isFinite(customHours) || customHours <= 0) return 0
  return customHours * 60 * 60 * 1000
}

/**
 * Delete expired image cache files and their dangling source references.
 * Files not matching the cache's MD5 naming convention are never touched.
 */
export function cleanupExpiredImageCache ({ imagesDir, refsPath, retentionMs, now = Date.now() }) {
  if (!Number.isFinite(retentionMs) || retentionMs <= 0 || !fs.existsSync(imagesDir)) {
    return { deleted: 0, bytesFreed: 0, refsRemoved: 0 }
  }

  let refs = {}
  try {
    if (fs.existsSync(refsPath)) {
      const parsed = JSON.parse(fs.readFileSync(refsPath, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) refs = parsed
    }
  } catch {
    // A damaged refs file must not be overwritten during cleanup.
    refs = null
  }

  const cutoff = now - retentionMs
  const removedRefs = new Set()
  let deleted = 0
  let bytesFreed = 0

  for (const entry of fs.readdirSync(imagesDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const match = entry.name.match(IMAGE_FILE_RE)
    if (!match) continue

    const ref = match[1]
    const filePath = path.join(imagesDir, entry.name)
    const stat = fs.statSync(filePath)
    const refUpdatedAt = refs && Number(refs[ref]?.updatedAt)
    const lastUpdatedAt = Number.isFinite(refUpdatedAt)
      ? Math.max(stat.mtimeMs, refUpdatedAt)
      : stat.mtimeMs
    if (lastUpdatedAt >= cutoff) continue

    fs.unlinkSync(filePath)
    deleted++
    bytesFreed += stat.size
    removedRefs.add(ref)
  }

  let refsRemoved = 0
  if (refs) {
    for (const ref of removedRefs) {
      const hasRemainingImage = ['jpg', 'png', 'gif', 'webp']
        .some(ext => fs.existsSync(path.join(imagesDir, `${ref}.${ext}`)))
      if (!hasRemainingImage && Object.prototype.hasOwnProperty.call(refs, ref)) {
        delete refs[ref]
        refsRemoved++
      }
    }
    if (refsRemoved > 0) fs.writeFileSync(refsPath, JSON.stringify(refs, null, 2))
  }

  return { deleted, bytesFreed, refsRemoved }
}
