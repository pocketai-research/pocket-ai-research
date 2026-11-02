export const REPO_URL = 'https://github.com/sanadaryuki10-lgtm/pocket-ai-research'

export default function Brand() {
  return (
    <div className="brand">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={32} height={32} />
      <span>Pocket AI Research</span>
    </div>
  )
}
