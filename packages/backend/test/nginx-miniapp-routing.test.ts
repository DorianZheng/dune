import test from 'node:test'
import assert from 'node:assert/strict'
import { patchMiniappNginxRouting } from '../src/agents/agent-manager.js'

const BASE_NGINX_CONFIG = `
server {
  listen 3000 default_server;
  location / {
    alias /usr/share/selkies/web/;
    try_files $uri $uri/ =404;
  }
  location /websocket {
    proxy_set_header Upgrade $http_upgrade;
    proxy_pass http://127.0.0.1:8082;
  }
}

server {
  listen 3001 ssl;
  location / {
    alias /usr/share/selkies/web/;
    try_files $uri $uri/ =404;
  }
  location /websocket {
    proxy_set_header Upgrade $http_upgrade;
    proxy_pass http://127.0.0.1:8082;
  }
}
`.trim()

test('patchMiniappNginxRouting inserts miniapp/webrtc blocks before each websocket location', () => {
  const patched = patchMiniappNginxRouting(BASE_NGINX_CONFIG)
  assert.equal(patched.changed, true)

  assert.equal((patched.text.match(/location \/websocket/g) || []).length, 2)
  assert.equal((patched.text.match(/location \/miniapps\//g) || []).length, 2)
  assert.equal((patched.text.match(/location \/webrtc/g) || []).length, 2)

  const firstMiniapps = patched.text.indexOf('location /miniapps/')
  const firstWebsocket = patched.text.indexOf('location /websocket')
  assert.ok(firstMiniapps >= 0 && firstMiniapps < firstWebsocket)
})

test('patchMiniappNginxRouting is idempotent when routes already exist', () => {
  const first = patchMiniappNginxRouting(BASE_NGINX_CONFIG)
  const second = patchMiniappNginxRouting(first.text)
  assert.equal(second.changed, false)
  assert.equal(second.text, first.text)
})

test('patchMiniappNginxRouting repairs partial routing coverage', () => {
  const partial = `
server {
  listen 3000 default_server;
  location /miniapps/ { alias /config/miniapps/; }
  location /webrtc { proxy_pass http://127.0.0.1:8082; }
  location /websocket { proxy_pass http://127.0.0.1:8082; }
}
server {
  listen 3001 ssl;
  location /websocket { proxy_pass http://127.0.0.1:8082; }
}
`.trim()

  const repaired = patchMiniappNginxRouting(partial)
  assert.equal(repaired.changed, true)
  assert.ok((repaired.text.match(/location \/miniapps\//g) || []).length >= 2)
  assert.ok((repaired.text.match(/location \/webrtc/g) || []).length >= 2)
})

test('patchMiniappNginxRouting fails when websocket anchor is missing', () => {
  const noAnchorConfig = `
server {
  listen 3000 default_server;
  location / {
    try_files $uri $uri/ =404;
  }
}
`.trim()

  assert.throws(
    () => patchMiniappNginxRouting(noAnchorConfig),
    /location \/websocket anchor not found/,
  )
})
