import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'

@customElement('typing-indicator')
export class TypingIndicator extends LitElement {
  @property({ type: Array }) names: string[] = []

  static styles = css`
    :host {
      display: block;
      font-size: 12px;
      color: var(--text-secondary);
      padding: 0 20px;
      min-height: 20px;
    }
    .dots span {
      display: inline-block;
      color: var(--text-secondary);
      animation: bounce 1.4s ease-in-out infinite;
    }
    .dots span:nth-child(2) { animation-delay: 0.15s; }
    .dots span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes bounce {
      0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-2px); }
    }
  `

  render() {
    if (this.names.length === 0) return html``
    const text = this.names.join(', ')
    return html`
      ${text} ${this.names.length === 1 ? 'is' : 'are'} thinking<span class="dots"><span>.</span><span>.</span><span>.</span></span>
    `
  }
}
