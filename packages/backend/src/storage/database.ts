import Database from 'better-sqlite3'
import { config } from '../config.js'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    mkdirSync(dirname(config.databasePath), { recursive: true })
    db = new Database(config.databasePath)
    db.pragma('journal_mode = WAL')
    initSchema(db)
  }
  return db
}

function initSchema(db: Database.Database) {
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      personality TEXT NOT NULL,
      host_exec_approval_mode TEXT NOT NULL DEFAULT 'approval-required',
      status TEXT NOT NULL DEFAULT 'stopped',
      avatar_color TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      mentioned_agent_ids TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_logs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      UNIQUE (agent_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_seq
      ON agent_logs(agent_id, seq DESC);

    CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_timestamp
      ON agent_logs(agent_id, timestamp DESC);

    CREATE TABLE IF NOT EXISTS subscriptions (
      agent_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, channel_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_read_cursors (
      agent_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      last_read_timestamp INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agent_id, channel_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, timestamp DESC);

    CREATE TABLE IF NOT EXISTS agent_mailbox_batches (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      leased_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      acked_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mailbox_batches_agent_status_expiry
      ON agent_mailbox_batches(agent_id, status, expires_at ASC);

    CREATE TABLE IF NOT EXISTS agent_mailbox_batch_messages (
      batch_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_timestamp INTEGER NOT NULL,
      PRIMARY KEY (batch_id, message_id),
      FOREIGN KEY (batch_id) REFERENCES agent_mailbox_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mailbox_batch_messages_batch
      ON agent_mailbox_batch_messages(batch_id, message_timestamp ASC);

    CREATE INDEX IF NOT EXISTS idx_mailbox_batch_messages_message
      ON agent_mailbox_batch_messages(message_id);

    CREATE TABLE IF NOT EXISTS agent_runtime_state (
      agent_id TEXT PRIMARY KEY,
      sandbox_name TEXT NOT NULL UNIQUE,
      sandbox_id TEXT NOT NULL,
      gui_http_port INTEGER NOT NULL,
      gui_https_port INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_started_at INTEGER,
      last_stopped_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runtime_state_sandbox_id
      ON agent_runtime_state(sandbox_id);

    CREATE TABLE IF NOT EXISTS agent_runtime_mounts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      host_path TEXT NOT NULL,
      guest_path TEXT NOT NULL,
      read_only INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      UNIQUE (agent_id, guest_path)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runtime_mounts_agent
      ON agent_runtime_mounts(agent_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS deployment_configs (
      agent_id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      build_command TEXT NOT NULL,
      start_command TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deployment_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      initiator TEXT NOT NULL,
      status TEXT NOT NULL,
      sandbox_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      stopped_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deployment_logs (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      line TEXT NOT NULL,
      PRIMARY KEY (run_id, seq),
      FOREIGN KEY (run_id) REFERENCES deployment_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_deployment_runs_agent_created
      ON deployment_runs(agent_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_deployment_logs_run_seq
      ON deployment_logs(run_id, seq);

    CREATE TABLE IF NOT EXISTS sandboxes (
      id TEXT PRIMARY KEY,
      name TEXT,
      status TEXT NOT NULL,
      image TEXT NOT NULL,
      cpus INTEGER NOT NULL,
      memory_mib INTEGER NOT NULL,
      disk_size_gb INTEGER NOT NULL,
      working_dir TEXT,
      env_json TEXT NOT NULL,
      entrypoint_json TEXT NOT NULL,
      cmd_json TEXT NOT NULL,
      user_value TEXT,
      volumes_json TEXT NOT NULL,
      ports_json TEXT NOT NULL,
      labels_json TEXT NOT NULL,
      auto_remove INTEGER NOT NULL DEFAULT 1,
      detach INTEGER NOT NULL DEFAULT 0,
      durability TEXT NOT NULL DEFAULT 'ephemeral',
      creator_type TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      managed_by_agent INTEGER NOT NULL DEFAULT 0,
      managed_agent_id TEXT,
      read_only INTEGER NOT NULL DEFAULT 0,
      read_only_reason TEXT,
      boxlite_box_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      stopped_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sandboxes_status
      ON sandboxes(status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_sandboxes_creator
      ON sandboxes(creator_type, creator_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS sandbox_acl (
      sandbox_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (sandbox_id, principal_type, principal_id, permission),
      FOREIGN KEY (sandbox_id) REFERENCES sandboxes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sandbox_acl_principal
      ON sandbox_acl(principal_type, principal_id, permission);

    CREATE TABLE IF NOT EXISTS sandbox_execs (
      id TEXT PRIMARY KEY,
      sandbox_id TEXT NOT NULL,
      status TEXT NOT NULL,
      command TEXT NOT NULL,
      args_json TEXT NOT NULL,
      env_json TEXT NOT NULL,
      timeout_seconds REAL,
      working_dir TEXT,
      tty INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      duration_ms INTEGER,
      exit_code INTEGER,
      error_message TEXT,
      stdout TEXT NOT NULL DEFAULT '',
      stderr TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (sandbox_id) REFERENCES sandboxes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sandbox_execs_sandbox_created
      ON sandbox_execs(sandbox_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS sandbox_exec_events (
      execution_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      sandbox_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (execution_id, seq),
      FOREIGN KEY (execution_id) REFERENCES sandbox_execs(id) ON DELETE CASCADE,
      FOREIGN KEY (sandbox_id) REFERENCES sandboxes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sandbox_exec_events_lookup
      ON sandbox_exec_events(execution_id, seq);

    CREATE TABLE IF NOT EXISTS sandbox_file_ops (
      id TEXT PRIMARY KEY,
      sandbox_id TEXT NOT NULL,
      op TEXT NOT NULL,
      path TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (sandbox_id) REFERENCES sandboxes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sandbox_file_ops_sandbox_created
      ON sandbox_file_ops(sandbox_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS host_command_requests (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      requested_by_type TEXT NOT NULL,
      requested_by_id TEXT NOT NULL,
      command TEXT NOT NULL,
      args_json TEXT NOT NULL,
      cwd TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      started_at INTEGER,
      completed_at INTEGER,
      approver_id TEXT,
      decision TEXT,
      elevated_confirmed INTEGER NOT NULL DEFAULT 0,
      exit_code INTEGER,
      stdout TEXT NOT NULL DEFAULT '',
      stderr TEXT NOT NULL DEFAULT '',
      stdout_truncated INTEGER NOT NULL DEFAULT 0,
      stderr_truncated INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_host_command_requests_status_created
      ON host_command_requests(status, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_host_command_requests_agent_created
      ON host_command_requests(agent_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      due_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_todos_agent_status_due
      ON todos(agent_id, status, due_at);

    CREATE TABLE IF NOT EXISTS claude_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      selected_model_provider TEXT,
      anthropic_api_key TEXT,
      claude_code_oauth_token TEXT,
      anthropic_auth_token TEXT,
      anthropic_base_url TEXT,
      claude_code_disable_nonessential_traffic TEXT,
      updated_at INTEGER NOT NULL
    );
  `)

  // Migration: add description column to existing databases
  try {
    db.exec(`ALTER TABLE channels ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
  } catch {
    // Column already exists — ignore
  }

  try {
    db.exec(`ALTER TABLE agents ADD COLUMN host_exec_approval_mode TEXT NOT NULL DEFAULT 'approval-required'`)
  } catch {
    // Column already exists — ignore
  }

  try {
    db.exec(`ALTER TABLE claude_settings ADD COLUMN selected_model_provider TEXT`)
  } catch {
    // Column already exists — ignore
  }
}
