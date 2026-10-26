/** Animated-image request storyboards: sample animation frames into one static preview. */

import type { OverlayOptions, Sharp } from 'sharp'
import type { ImageRequestTarget } from '@deepseek-ai/dsh-attachment'
import { requireSharp } from './sharp.ts'

/** Most frames sampled from one animated source into a request storyboard. */
const STORYBOARD_MAX_FRAMES = 6
/** Cell inset in pixels when a cell is large enough to show a divider. */
const STORYBOARD_INSET = 2
/** Neutral canvas behind sampled frames. */
const STORYBOARD_BACKGROUND = { r: 242, g: 242, b: 242 }
/** Frame backdrop; transparent sticker pixels become white. */
const FRAME_BACKGROUND = { r: 255, g: 255, b: 255 }

function samplePages(total: number, count: number): number[] {
  if (count >= total) return Array.from({ length: total }, (_, index) => index)
  if (count <= 1) return [0]
  return Array.from({ length: count }, (_, index) => Math.round(index * (total - 1) / (count - 1)))
}

function overlaySvg(
  target: ImageRequestTarget,
  columns: number,
  count: number,
  cellWidth: number,
  cellHeight: number,
  offsetX: number,
  offsetY: number,
): string {
  const badges = cellWidth >= 16 && cellHeight >= 16
  const fontSize = Math.max(10, Math.min(24, Math.floor(Math.min(cellWidth, cellHeight) / 8)))
  const badgeWidth = fontSize + 8
  const badgeHeight = fontSize + 4
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${target.width}" height="${target.height}">`
  for (let index = 0; index < count; index += 1) {
    const left = offsetX + (index % columns) * cellWidth
    const top = offsetY + Math.floor(index / columns) * cellHeight
    svg += `<rect x="${left}" y="${top}" width="${cellWidth}" height="${cellHeight}" fill="none" stroke="#9a9a9a" stroke-width="1"/>`
    if (badges) {
      svg += `<rect x="${left + 3}" y="${top + 3}" width="${badgeWidth}" height="${badgeHeight}" rx="3" fill="#000" fill-opacity="0.65"/>`
      svg += `<text x="${left + 3 + badgeWidth / 2}" y="${top + 3 + badgeHeight / 2}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-weight="bold" font-size="${fontSize}" fill="#fff">${index + 1}</text>`
    }
  }
  return `${svg}</svg>`
}

/**
 * Build one static storyboard for a multi-frame source: evenly sampled frames
 * laid out in reading order at the exact request target dimensions, each tile
 * numbered so the model can follow the sequence instead of guessing from one frame.
 * @param data - admitted animated GIF or WebP bytes.
 * @param target - exact route-chosen output dimensions and encoded-byte target.
 * @returns sRGB pipeline of the composed storyboard before quality-ladder encoding.
 */
export async function storyboardPipeline(
  data: Uint8Array,
  target: ImageRequestTarget,
): Promise<Sharp> {
  const sharp = requireSharp()
  const metadata = await sharp(data, { failOn: 'error', limitInputPixels: false }).metadata()
  // Admission marked this source animated, which requires more than one page.
  const total = metadata.pages as number
  const count = Math.max(1, Math.min(STORYBOARD_MAX_FRAMES, total, target.width * target.height))
  const columns = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * target.width / target.height))))
  const rows = Math.ceil(count / columns)
  const cellWidth = Math.floor(target.width / columns)
  const cellHeight = Math.floor(target.height / rows)
  const offsetX = Math.floor((target.width - cellWidth * columns) / 2)
  const offsetY = Math.floor((target.height - cellHeight * rows) / 2)
  const inset = cellWidth >= 8 && cellHeight >= 8 ? STORYBOARD_INSET : 0
  const frameWidth = Math.max(1, cellWidth - inset * 2)
  const frameHeight = Math.max(1, cellHeight - inset * 2)
  const composites: OverlayOptions[] = []
  for (const [index, page] of samplePages(total, count).entries()) {
    const frame = await sharp(data, { page, pages: 1, failOn: 'error', limitInputPixels: false })
      .toColourspace('srgb')
      .resize({ width: frameWidth, height: frameHeight, fit: 'contain', background: FRAME_BACKGROUND })
      .flatten({ background: FRAME_BACKGROUND })
      .png()
      .toBuffer({ resolveWithObject: true })
    composites.push({
      input: frame.data,
      left: offsetX + (index % columns) * cellWidth + Math.floor((cellWidth - frame.info.width) / 2),
      top: offsetY + Math.floor(index / columns) * cellHeight + Math.floor((cellHeight - frame.info.height) / 2),
    })
  }
  composites.push({
    input: Buffer.from(overlaySvg(target, columns, count, cellWidth, cellHeight, offsetX, offsetY)),
    left: 0,
    top: 0,
  })
  return sharp({
    create: { width: target.width, height: target.height, channels: 3, background: STORYBOARD_BACKGROUND },
  }).composite(composites)
}
