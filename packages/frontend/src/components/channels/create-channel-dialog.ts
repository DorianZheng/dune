import { LitElement, html, css } from 'lit'
import { customElement, query, state as litState } from 'lit/decorators.js'

@customElement('create-channel-dialog')
export class CreateChannelDialog extends LitElement {
  @query('dialog') dialog!: HTMLDialogElement
  @litState() private errorMsg = ''

  static styles = css`
    dialog {
      background: var(--bg-elevated);
      color: var(--text-primary);
      border: none;
      border-radius: var(--radius-lg);
      padding: 16px;
      max-width: 520px;
      width: min(92vw, 520px);
      box-shadow: var(--shadow-lg);
    }

    dialog::backdrop {
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(2px);
    }

    h2 {
      font-size: var(--text-title-size);
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.25;
      margin-bottom: 4px;
    }

    .subtitle {
      font-size: var(--text-meta-size);
      color: var(--text-muted);
      margin-bottom: var(--space-md);
    }

    label {
      display: block;
      font-size: var(--text-body-size);
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: var(--space-xs);
      margin-top: var(--space-md);
    }

    .optional {
      font-weight: 500;
      color: var(--text-muted);
      font-size: 12px;
      margin-left: var(--space-xs);
    }

    input[type='text'] {
      width: 100%;
      background: var(--bg-surface);
      border: none;
      border-radius: var(--radius-sm);
      padding: 9px 11px;
      color: var(--text-primary);
      font-family: var(--font);
      font-size: var(--text-body-size);
      outline: none;
      box-sizing: border-box;
      transition: box-shadow var(--transition-fast);
    }

    input[type='text']:focus {
      box-shadow: 0 0 0 2px var(--focus-ring);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-sm);
      margin-top: var(--space-md);
    }

    button {
      height: var(--control-height);
      border-radius: var(--radius-sm);
      border: none;
      padding: 0 14px;
      font-size: var(--text-secondary-size);
      font-weight: 600;
      transition: all var(--transition-fast);
    }

    .cancel {
      background: var(--bg-surface);
      color: var(--text-primary);
    }

    .cancel:hover {
      background: var(--bg-hover);
    }

    .create {
      background: var(--accent);
      color: white;
    }

    .create:hover {
      background: var(--accent-hover);
    }

    .error {
      color: var(--error);
      font-size: 13px;
      margin-top: var(--space-sm);
      background: color-mix(in srgb, var(--error) 10%, transparent);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
    }

    @media (max-width: 760px) {
      dialog {
        border-radius: var(--radius);
        padding: 20px;
      }

      .actions {
        margin-top: var(--space-md);
      }
    }
  `

  open() {
    this.errorMsg = ''
    this.shadowRoot?.querySelector('form')?.reset()
    this.dialog?.showModal()
  }

  close() {
    this.errorMsg = ''
    this.dialog?.close()
  }

  showError(msg: string) {
    this.errorMsg = msg
    if (!this.dialog?.open) this.dialog?.showModal()
  }

  private handleSubmit() {
    const form = this.shadowRoot!.querySelector('form') as HTMLFormElement
    const name = (form.querySelector('[name=name]') as HTMLInputElement).value.trim()
    if (!name) return
    const description = (form.querySelector('[name=description]') as HTMLInputElement)?.value?.trim() || ''
    this.errorMsg = ''
    this.dispatchEvent(new CustomEvent('channel-created', {
      detail: { name, description },
      bubbles: true,
      composed: true,
    }))
  }

  render() {
    return html`
      <dialog>
        <h2>Create Channel</h2>
        <p class="subtitle">Channels organize workstreams and make agent coordination predictable.</p>
        <form @submit=${(e: Event) => { e.preventDefault(); this.handleSubmit() }}>
          <label for="channel-name">Channel name</label>
          <input id="channel-name" type="text" name="name" placeholder="e.g. product-launch" required>

          <label for="channel-description">
            Description
            <span class="optional">optional</span>
          </label>
          <input id="channel-description" type="text" name="description" placeholder="What is this channel for?">

          ${this.errorMsg ? html`<div class="error">${this.errorMsg}</div>` : ''}

          <div class="actions">
            <button type="button" class="cancel" @click=${this.close}>Cancel</button>
            <button type="submit" class="create">Create</button>
          </div>
        </form>
      </dialog>
    `
  }
}
