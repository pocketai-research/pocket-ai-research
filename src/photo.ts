/**
 * Photo sizes for the vision model's encoder. 448 px is one tile. llama.cpp cuts anything larger
 * into 448 px tiles plus an overview: up to 896 px that is 4 + 1 tiles, so small text is easier
 * to read but the photo takes about five times longer on a phone CPU.
 */
export const PHOTO_SIZE = 448
export const DETAIL_PHOTO_SIZE = 896

/** Scales a photo down so its longer side is at most maxSide pixels and returns it as a JPEG data URL. */
export async function photoToDataUrl(file: File, maxSide = PHOTO_SIZE): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.85)
}
