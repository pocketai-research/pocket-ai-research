const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const MenuIcon = () => (
  <svg {...base}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
)

export const PlusIcon = () => (
  <svg {...base}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const CloseIcon = () => (
  <svg {...base}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const MapIcon = () => (
  <svg {...base}>
    <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
  </svg>
)

export const SlidersIcon = () => (
  <svg {...base}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" />
  </svg>
)

export const ArrowLeftIcon = () => (
  <svg {...base}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
)

export const PaperclipIcon = () => (
  <svg {...base}>
    <path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
  </svg>
)

export const FileIcon = () => (
  <svg {...base} width={14} height={14}>
    <path d="M14 3H6v18h12V7zM14 3v4h4" />
  </svg>
)

export const StarIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
  </svg>
)

export const RouteIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M6 20v-7a4 4 0 0 1 4-4h9M15 5l4 4-4 4" />
  </svg>
)

export const CameraIcon = () => (
  <svg {...base}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
)

export const MicIcon = () => (
  <svg {...base}>
    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
)

export const SpeakerIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" />
  </svg>
)

export const StopIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M7 7h10v10H7z" />
  </svg>
)

export const CopyIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M9 9h10v10H9zM5 15V5h10" />
  </svg>
)

export const ShareIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5" />
  </svg>
)

export const RefreshIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </svg>
)

export const ChevronUpIcon = () => (
  <svg {...base}>
    <path d="M6 15l6-6 6 6" />
  </svg>
)

export const ChevronDownIcon = () => (
  <svg {...base}>
    <path d="M6 9l6 6 6-6" />
  </svg>
)

export const TrashIcon = () => (
  <svg {...base}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
)
