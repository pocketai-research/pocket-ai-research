import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// react-markdown never renders raw HTML from the model, so replies cannot inject markup.
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}

const plugins = [remarkGfm]

// A line that is only a number and a full stop ("1564.", a whole answer) is an empty numbered
// list item in Markdown, which shows the number as a list marker; keep it as text.
const keepBareNumbers = (text: string) => text.replace(/^(\s*\d+)\.(\s*)$/gm, '$1\\.$2')

// Memoized so earlier messages are not re-parsed on every streamed token.
export default memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {keepBareNumbers(text)}
      </ReactMarkdown>
    </div>
  )
})
