/**
 * Lazy-loaded Shiki highlighter singleton.
 * Shiki generates safe HTML from code strings (no user HTML is passed through).
 * The output is further sanitized by DOMPurify in message-item.ts before rendering.
 */
import type { BundledLanguage, BundledTheme, HighlighterGeneric } from 'shiki'
import DOMPurify from 'dompurify'

let highlighterPromise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | null = null

const PRELOADED_LANGS: BundledLanguage[] = [
  'javascript', 'typescript', 'python', 'bash', 'json', 'html', 'css',
]

async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['github-dark', 'github-light'],
        langs: PRELOADED_LANGS,
      }),
    )
  }
  return highlighterPromise
}

/**
 * Highlight a code string. Returns a DOMPurify-sanitized HTML string.
 * Loads language grammars on demand if not preloaded.
 */
export async function highlightCode(code: string, lang: string): Promise<string> {
  try {
    const highlighter = await getHighlighter()
    const loadedLangs = highlighter.getLoadedLanguages()
    const normalizedLang = lang.toLowerCase().trim()

    if (normalizedLang && !loadedLangs.includes(normalizedLang as BundledLanguage)) {
      try {
        await highlighter.loadLanguage(normalizedLang as BundledLanguage)
      } catch {
        // Language not supported by Shiki — fall back to plain text
        return ''
      }
    }

    const raw = highlighter.codeToHtml(code, {
      lang: normalizedLang || 'text',
      theme: isDarkTheme() ? 'github-dark' : 'github-light',
    })
    // Sanitize Shiki output (it only contains <pre><code><span> with inline styles)
    return DOMPurify.sanitize(raw)
  } catch {
    return ''
  }
}

function isDarkTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark'
    || window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Walk a container, find all <pre><code> blocks,
 * and replace their content with Shiki-highlighted HTML.
 * Also adds copy buttons to each code block.
 */
export async function highlightCodeBlocks(root: HTMLElement | ShadowRoot): Promise<void> {
  const codeBlocks = root.querySelectorAll<HTMLElement>('pre code')
  if (codeBlocks.length === 0) return

  const tasks = Array.from(codeBlocks).map(async (codeEl) => {
    const preEl = codeEl.parentElement
    if (!preEl || preEl.dataset.highlighted === 'true') return

    // Extract language from class="language-xxx"
    const langClass = Array.from(codeEl.classList).find((c) => c.startsWith('language-'))
    const lang = langClass?.replace('language-', '') || ''
    const code = codeEl.textContent || ''

    const highlighted = await highlightCode(code, lang)
    if (highlighted) {
      // Parse the sanitized Shiki HTML and extract the <pre> content
      const template = document.createElement('template')
      template.innerHTML = highlighted
      const shikiPre = template.content.querySelector('pre')
      if (shikiPre) {
        // Move Shiki's child nodes into the original pre element
        preEl.textContent = ''
        while (shikiPre.firstChild) {
          preEl.appendChild(shikiPre.firstChild)
        }
        if (shikiPre.style.background) preEl.style.background = shikiPre.style.background
        if (shikiPre.style.color) preEl.style.color = shikiPre.style.color
      }
    }

    addCopyButton(preEl, code)
    preEl.dataset.highlighted = 'true'
  })

  await Promise.all(tasks)
}

function addCopyButton(preEl: HTMLElement, code: string): void {
  if (preEl.querySelector('.copy-btn')) return

  const btn = document.createElement('button')
  btn.className = 'copy-btn'
  btn.title = 'Copy code'
  btn.textContent = 'Copy'

  btn.addEventListener('click', async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(code)
      btn.textContent = 'Copied!'
      setTimeout(() => { btn.textContent = 'Copy' }, 1500)
    } catch {
      // Fallback for non-secure contexts
    }
  })

  preEl.style.position = 'relative'
  preEl.appendChild(btn)
}
