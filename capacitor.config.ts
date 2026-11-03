import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.pocketairesearch.app',
  appName: 'Pocket Ai Research',
  webDir: 'dist',
  // Identifies the app to the services it calls. OpenFreeMap requires this for offline
  // downloads; src/map/download.ts checks for it.
  appendUserAgent: 'PocketAiResearch (+https://github.com/pocketai-research/pocket-ai-research)',
}

export default config
