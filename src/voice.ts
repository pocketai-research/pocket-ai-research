import { Capacitor } from '@capacitor/core'
import { SpeechRecognition } from '@capacitor-community/speech-recognition'
import { TextToSpeech } from '@capacitor-community/text-to-speech'
import type { ReplySettings } from './settings'

const native = Capacitor.isNativePlatform()

// Chrome's Web Speech API, not in TypeScript's DOM library. In desktop Chrome it sends audio to
// Google's servers, so on the web speech input needs a connection.
interface WebRecognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type WebRecognitionClass = new () => WebRecognition
const WebSpeech = ((window as unknown as Record<string, unknown>).SpeechRecognition ??
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as WebRecognitionClass | undefined

let webRecognition: WebRecognition | null = null

/** BCP 47 language for speech, from the reply language setting. */
export function speechLanguage(language: ReplySettings['language']) {
  if (language === 'indonesian') return 'id-ID'
  if (language === 'english') return 'en-US'
  return navigator.language || 'en-US'
}

export async function canListen(): Promise<boolean> {
  if (!native) return Boolean(WebSpeech)
  try {
    return (await SpeechRecognition.available()).available
  } catch {
    return false
  }
}

/**
 * Listens until the speaker pauses and resolves with what was said ("" if nothing was heard).
 * On the web, onText receives the transcript as it forms. On Android the phone's own speech
 * recogniser is used; it works offline when the language's offline pack is installed.
 */
export async function listen(language: string, onText: (text: string) => void): Promise<string> {
  if (native) {
    const permission = await SpeechRecognition.requestPermissions()
    if (permission.speechRecognition !== 'granted') throw new Error('Microphone permission was denied.')
    try {
      const { matches } = await SpeechRecognition.start({ language, maxResults: 1, partialResults: false, popup: false })
      return matches?.[0] ?? ''
    } catch (err) {
      // Android reports silence as an error ("No match", "Speech timeout").
      if (/no match|timeout/i.test(String(err))) return ''
      throw err
    }
  }

  if (!WebSpeech) throw new Error('Speech input is not available in this browser.')
  return new Promise((resolve, reject) => {
    const recognition = new WebSpeech()
    webRecognition = recognition
    recognition.lang = language
    recognition.interimResults = true
    recognition.continuous = false
    let text = ''
    recognition.onresult = (event) => {
      text = Array.from(event.results, (result) => result[0].transcript).join('')
      onText(text)
    }
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      reject(
        new Error(
          event.error === 'not-allowed'
            ? 'Microphone permission was denied.'
            : event.error === 'network'
              ? 'Speech input in this browser needs an internet connection.'
              : `Speech input failed (${event.error}).`,
        ),
      )
    }
    recognition.onend = () => {
      webRecognition = null
      resolve(text)
    }
    recognition.start()
  })
}

export function stopListening() {
  if (native) SpeechRecognition.stop().catch(() => {})
  else webRecognition?.stop()
}

/** Markdown to plain sentences for reading aloud. */
function toSpeech(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (code) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\d+\]/g, '')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const INDONESIAN_WORDS = /\b(yang|dan|di|untuk|dengan|adalah|ini|itu|tidak|dari|ke|kamu|anda)\b/gi

/** Reading language: the setting, or a guess from the text when it follows the user. */
function readingLanguage(text: string, language: ReplySettings['language']) {
  if (language !== 'auto') return speechLanguage(language)
  return (text.match(INDONESIAN_WORDS)?.length ?? 0) >= 3 ? 'id-ID' : 'en-US'
}

/** Reads text aloud with the device's voice; resolves when it has finished or was stopped. */
export async function speak(text: string, language: ReplySettings['language']) {
  await TextToSpeech.stop().catch(() => {})
  await TextToSpeech.speak({ text: toSpeech(text), lang: readingLanguage(text, language), rate: 1.0 })
}

export function stopSpeaking() {
  TextToSpeech.stop().catch(() => {})
}
