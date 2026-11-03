/**
 * Scales a photo down so its longer side is at most maxSide pixels and returns it as a JPEG data
 * URL. 448 px is one tile for the vision model's encoder: llama.cpp cuts anything larger into
 * several 448 px tiles plus an overview, which makes a 640 × 480 photo about five times slower
 * to read on a phone CPU.
 */
export async function photoToDataUrl(file: File, maxSide = 448): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.85)
}
