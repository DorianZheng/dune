/**
 * Lazy-loaded KaTeX renderer for LaTeX math expressions.
 * Detects $...$ (inline) and $$...$$ (block) math in rendered HTML
 * and replaces them with KaTeX-rendered output.
 *
 * All KaTeX output is sanitized via DOMPurify before DOM insertion.
 */
import DOMPurify from 'dompurify'

let katexModule: typeof import('katex') | null = null

// MathML tags and attributes that KaTeX generates
const KATEX_PURIFY_CONFIG = {
  ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub',
    'mfrac', 'mover', 'munder', 'mspace', 'mtable', 'mtr', 'mtd',
    'annotation', 'mstyle', 'mpadded', 'mtext', 'merror', 'msqrt', 'mroot'],
  ADD_ATTR: ['mathvariant', 'mathsize', 'stretchy', 'fence', 'separator',
    'displaystyle', 'encoding', 'xmlns', 'style', 'class', 'aria-hidden',
    'width', 'height', 'viewBox', 'd'],
}

async function getKatex() {
  if (!katexModule) {
    katexModule = await import('katex')
    // Inject KaTeX CSS into document head if not already present
    if (!document.querySelector('link[href*="katex"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css'
      document.head.appendChild(link)
    }
  }
  return katexModule.default || katexModule
}

/**
 * Process a container's text nodes for LaTeX math expressions.
 * Replaces $$...$$ blocks and $...$ inline math with rendered KaTeX.
 */
export async function renderMathBlocks(root: HTMLElement | ShadowRoot): Promise<void> {
  const contentEls = root.querySelectorAll<HTMLElement>('.content, .chat-bubble-content, .markdown-body')
  if (contentEls.length === 0) return

  const katex = await getKatex()

  for (const el of contentEls) {
    if (el.dataset.mathRendered === 'true') continue
    processMathInElement(el, katex)
    el.dataset.mathRendered = 'true'
  }
}

function renderTex(katex: { renderToString: (tex: string, opts?: object) => string }, tex: string, displayMode: boolean): string {
  const raw = katex.renderToString(tex.trim(), { displayMode, throwOnError: false })
  return DOMPurify.sanitize(raw, KATEX_PURIFY_CONFIG)
}

function processMathInElement(el: HTMLElement, katex: { renderToString: (tex: string, opts?: object) => string }): void {
  const blockRegex = /\$\$([\s\S]+?)\$\$/g
  const inlineRegex = /(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
  const textNodes: Text[] = []
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    if (node.parentElement?.closest('pre, code')) continue
    if (node.textContent?.includes('$')) {
      textNodes.push(node)
    }
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent || ''
    if (!text.includes('$')) continue

    let newContent = text
    let hasMatch = false

    newContent = newContent.replace(blockRegex, (match, tex) => {
      try { hasMatch = true; return renderTex(katex, tex, true) }
      catch { return match }
    })

    newContent = newContent.replace(inlineRegex, (match, tex) => {
      if (/^\d+([.,]\d+)?$/.test(tex.trim())) return match
      try { hasMatch = true; return renderTex(katex, tex, false) }
      catch { return match }
    })

    if (hasMatch) {
      // Create a document fragment from sanitized KaTeX HTML
      const template = document.createElement('template')
      template.innerHTML = DOMPurify.sanitize(newContent, KATEX_PURIFY_CONFIG)
      textNode.replaceWith(template.content)
    }
  }
}
