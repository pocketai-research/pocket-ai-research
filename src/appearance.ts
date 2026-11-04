/**
 * Light or dark look and text size, chosen on the start page and kept on this device. The choice is
 * set as `data-theme` and `data-text` on <html>, which index.css reads. index.html applies the saved
 * choice before the page is first drawn, so it shows without a flash of the other theme.
 */
export type Theme = 'system' | 'light' | 'dark'
export type TextSize = 'normal' | 'large' | 'larger'

export interface Appearance {
  theme: Theme
  textSize: TextSize
}

/** Also read by the script in index.html. */
const KEY = 'pocket-ai:appearance'

export function readAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      theme: saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : 'system',
      textSize: saved.textSize === 'large' || saved.textSize === 'larger' ? saved.textSize : 'normal',
    }
  } catch {
    return { theme: 'system', textSize: 'normal' }
  }
}

export function saveAppearance(appearance: Appearance) {
  const root = document.documentElement
  if (appearance.theme === 'system') delete root.dataset.theme
  else root.dataset.theme = appearance.theme
  if (appearance.textSize === 'normal') delete root.dataset.text
  else root.dataset.text = appearance.textSize
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance))
  } catch {
    // Private mode or storage full: the choice still applies until the app is closed.
  }
}
