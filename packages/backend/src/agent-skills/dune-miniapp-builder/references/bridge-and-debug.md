# Bridge and Debug Reference

## Iframe -> Host Action

```js
const requestId = crypto.randomUUID();
window.parent.postMessage(
  {
    type: 'dune:miniapp-action',
    requestId,
    action: 'echo',
    payload: { text: 'hello' }
  },
  '*'
);
```

## Host -> Iframe Result

```js
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type !== 'dune:miniapp-action-result') return;
  if (msg.requestId !== pendingRequestId) return;
  if (!msg.ok) {
    showError(msg.error || 'Action failed');
    return;
  }
  applyResult(msg.response);
});
```

## Reserved Host Action: AskUserQuestion

The host handles user-question actions directly (without backend roundtrip) for these names:

- `AskUserQuestion`
- `askUserQuestion`
- `ask_user_question`

### Supported Payload

```js
{
  question: 'Primary question text', // fallback: prompt or text
  placeholder: 'Type your answer...',
  defaultValue: 'prefilled answer',
  choices: [
    'Option A',
    { label: 'Option B', value: 'b' }
  ]
}
```

- Question text uses first non-empty value from `question`, `prompt`, `text`.
- `choices` can be string array or object array (`label` required, `value` optional).

### Success Result

```js
{
  type: 'dune:miniapp-action-result',
  requestId: '...',
  ok: true,
  response: 'plain string answer'
}
```

### Cancel Result

```js
{
  type: 'dune:miniapp-action-result',
  requestId: '...',
  ok: false,
  error: 'User cancelled'
}
```

### Concurrency Guard

If one `AskUserQuestion` is already open and another arrives, host returns:

```js
{
  type: 'dune:miniapp-action-result',
  requestId: '...',
  ok: false,
  error: 'AskUserQuestion already pending'
}
```

## Runtime Troubleshooting

1. Open endpoint returns URL but iframe shows 404:
   - check app `entry` path and file existence.
   - verify nginx has `location /miniapps/` route in both server blocks.
2. App not listed:
   - validate `app.json` JSON and slug safety.
   - ensure app folder name is safe and contains manifest.
3. Action returns timeout/error:
   - confirm action name is non-empty.
   - handle `ok:false` in UI and show a non-blocking error state.
