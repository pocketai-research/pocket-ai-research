export const REPO_URL = 'https://github.com/minusonedoge-cloud/pocket-ai-research'

export default function Brand() {
  return (
    <div className="brand">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={32} height={32} />
      <span>Pocket Ai Research</span>
    </div>
  )
}
