import { useState } from 'react'
import { addModelFile, addModelLink, formatBytes, MAX_MODEL_BYTES } from './ai/customModels'
import type { ModelOption } from './ai/models'

/** Adds a model of one's own, from a GGUF file on the device or a link to one (src/ai/customModels.ts). */
export default function AddModelPanel({ disabled, onAdded }: { disabled: boolean; onAdded: (model: ModelOption) => void }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)

  async function add(working: string, action: () => Promise<ModelOption>, done: (model: ModelOption) => string) {
    setBusy(true)
    setStatus({ text: working })
    try {
      const model = await action()
      onAdded(model)
      setStatus({ text: done(model) })
      return true
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), error: true })
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="add-model">
      <summary>Add your own model</summary>
      <p className="section-intro">
        Any chat model in GGUF format up to {formatBytes(MAX_MODEL_BYTES)}, for example a Q4_K_M file from Hugging Face. Pick
        one made for chat (its name usually says Instruct, Chat or it): base models only continue your text. Text only:
        vision models need a second file and cannot be added here.
      </p>
      <label className={`btn ghost${busy || disabled ? ' disabled' : ''}`} aria-disabled={busy || disabled}>
        Choose a GGUF file
        <input
          type="file"
          hidden
          disabled={busy || disabled}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            add(
              `Copying ${file.name}…`,
              () =>
                addModelFile(file, (fraction) => setStatus({ text: `Copying ${file.name}… ${Math.round(fraction * 100)}%` })),
              (model) => `${model.name} was added and works offline. Find it in the list above.`,
            )
          }}
        />
      </label>
      <form
        className="add-model-link"
        onSubmit={async (e) => {
          e.preventDefault()
          const added = await add(
            'Checking the link…',
            () => addModelLink(link),
            (model) => `${model.name} (${model.size}) was added. Tap Download on its card to get it.`,
          )
          if (added) setLink('')
        }}
      >
        <input
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://huggingface.co/…/model-Q4_K_M.gguf"
          aria-label="Link to a GGUF file"
          disabled={busy || disabled}
        />
        <button className="btn primary" disabled={busy || disabled || !link.trim()}>
          Add
        </button>
      </form>
      {status && (
        <p className={status.error ? 'alert' : 'muted small'} role="status">
          {status.text}
        </p>
      )}
    </details>
  )
}
