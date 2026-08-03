export function detectSupportedImageMime (buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return ''
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return 'image/png'
  const head = buffer.toString('ascii', 0, Math.min(buffer.length, 12))
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  return ''
}

export function requireSupportedImage (buffer) {
  const mimeType = detectSupportedImageMime(buffer)
  if (!mimeType) throw new Error('不是受支持的图片')
  return { buffer, mimeType }
}
