import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { cleanupExpiredImageCache, resolveImageRetentionMs } from './imageCacheCleanup.js'

test('resolves presets and custom retention', () => {
  assert.equal(resolveImageRetentionMs({ imageRetentionPreset: 'forever' }), 0)
  assert.equal(resolveImageRetentionMs({ imageRetentionPreset: '7d' }), 7 * 24 * 60 * 60 * 1000)
  assert.equal(resolveImageRetentionMs({ imageRetentionPreset: 'custom', imageRetentionCustomHours: 12 }), 12 * 60 * 60 * 1000)
  assert.equal(resolveImageRetentionMs({ imageRetentionPreset: 'custom', imageRetentionCustomHours: 0 }), 0)
})

test('deletes only expired cache images and updates refs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-image-cleanup-'))
  try {
    const refsPath = path.join(dir, 'refs.json')
    const oldRef = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const freshRef = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const oldFile = path.join(dir, `${oldRef}.jpg`)
    const freshFile = path.join(dir, `${freshRef}.png`)
    const unrelatedFile = path.join(dir, 'keep-me.txt')
    fs.writeFileSync(oldFile, 'old')
    fs.writeFileSync(freshFile, 'fresh')
    fs.writeFileSync(unrelatedFile, 'safe')
    fs.writeFileSync(refsPath, JSON.stringify({
      [oldRef]: { ref: oldRef, updatedAt: 1 },
      [freshRef]: { ref: freshRef, updatedAt: 9_500 }
    }))
    fs.utimesSync(oldFile, new Date(1), new Date(1))
    fs.utimesSync(freshFile, new Date(9_500), new Date(9_500))

    const result = cleanupExpiredImageCache({
      imagesDir: dir,
      refsPath,
      retentionMs: 1_000,
      now: 10_000
    })

    assert.deepEqual(result, { deleted: 1, bytesFreed: 3, refsRemoved: 1 })
    assert.equal(fs.existsSync(oldFile), false)
    assert.equal(fs.existsSync(freshFile), true)
    assert.equal(fs.existsSync(unrelatedFile), true)
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(refsPath, 'utf8'))), [freshRef])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
