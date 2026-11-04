export const REPO_URL = 'https://github.com/pocketai-research/pocket-ai-research'

export default function Brand() {
  return (
    <div className="brand">
      <img src={`${import.meta.env.BASE_URL}favicon.png`} alt="" width={32} height={32} />
      <span>Pocket Ai Research</span>
    </div>
  )
}
