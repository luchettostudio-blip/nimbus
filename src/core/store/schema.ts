/**
 * Migrazioni dello schema SQLite. `user_version` indica l'ultima applicata.
 * Regola: non modificare mai una migrazione già rilasciata, aggiungerne una nuova.
 * (Equivalente Swift: GRDB `DatabaseMigrator` con le stesse stringhe SQL.)
 */
export const MIGRATIONS: string[] = [
  // v1 — schema iniziale
  `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS folders (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    delimiter TEXT NOT NULL,
    unread INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    uid_validity INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, path)
  );
  CREATE TABLE IF NOT EXISTS messages (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder TEXT NOT NULL,
    uid INTEGER NOT NULL,
    message_id TEXT,
    subject TEXT NOT NULL,
    from_name TEXT,
    from_address TEXT,
    to_json TEXT NOT NULL DEFAULT '[]',
    date INTEGER NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    seen INTEGER NOT NULL DEFAULT 0,
    flagged INTEGER NOT NULL DEFAULT 0,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, folder, uid)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_list ON messages(account_id, folder, date DESC);
  CREATE TABLE IF NOT EXISTS bodies (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder TEXT NOT NULL,
    uid INTEGER NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (account_id, folder, uid)
  );
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // v2 — firme, outbox, snooze, allegati, ricerca FTS5, thread, inbox divisa, disiscrizioni
  `
  ALTER TABLE messages ADD COLUMN in_reply_to TEXT;
  ALTER TABLE messages ADD COLUMN refs TEXT;
  ALTER TABLE messages ADD COLUMN thread_id TEXT;
  ALTER TABLE messages ADD COLUMN category TEXT;
  ALTER TABLE messages ADD COLUMN list_unsubscribe TEXT;
  ALTER TABLE messages ADD COLUMN list_unsubscribe_post TEXT;
  ALTER TABLE messages ADD COLUMN list_id TEXT;
  ALTER TABLE messages ADD COLUMN precedence TEXT;
  ALTER TABLE messages ADD COLUMN auto_submitted TEXT;
  ALTER TABLE messages ADD COLUMN woke_at INTEGER;
  ALTER TABLE messages ADD COLUMN attachment_names TEXT NOT NULL DEFAULT '';
  ALTER TABLE messages ADD COLUMN indexed INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(account_id, thread_id);
  CREATE INDEX IF NOT EXISTS idx_messages_msgid ON messages(account_id, message_id);
  CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(account_id, from_address);

  -- 1. Firme
  CREATE TABLE signatures (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    html TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE signature_images (
    cid TEXT PRIMARY KEY,
    signature_id TEXT REFERENCES signatures(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    data BLOB NOT NULL
  );
  CREATE TABLE account_prefs (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    sig_new_id TEXT,
    sig_reply_id TEXT
  );

  -- 2. Outbox (annulla invio + invio programmato)
  CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL,
    send_at INTEGER NOT NULL,
    kind TEXT NOT NULL,              -- 'undo' | 'scheduled'
    status TEXT NOT NULL,            -- 'pending' | 'sending' | 'missed' | 'failed'
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_outbox_due ON outbox(status, send_at);

  -- 3. Snooze
  CREATE TABLE snoozes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    from_json TEXT,
    snippet TEXT NOT NULL DEFAULT '',
    original_folder TEXT NOT NULL,
    wake_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_snoozes_wake ON snoozes(wake_at);

  -- 4. Cache allegati (file su disco)
  CREATE TABLE attachment_cache (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder TEXT NOT NULL,
    uid INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    PRIMARY KEY (account_id, folder, uid, idx)
  );

  -- 5. Ricerca full-text (rowid = rowid di messages)
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    sender, recipients, subject, body, attachments,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  INSERT INTO messages_fts (rowid, sender, recipients, subject, body, attachments)
    SELECT rowid, coalesce(from_name,'') || ' ' || coalesce(from_address,''), to_json, subject, snippet, attachment_names FROM messages;
  CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, sender, recipients, subject, body, attachments)
    VALUES (new.rowid, coalesce(new.from_name,'') || ' ' || coalesce(new.from_address,''), new.to_json, new.subject, new.snippet, new.attachment_names);
  END;
  CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
  END;

  -- 6. Thread
  CREATE TABLE thread_links (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    PRIMARY KEY (account_id, message_id)
  );
  CREATE INDEX idx_thread_links_thread ON thread_links(account_id, thread_id);

  -- 7. Inbox divisa
  CREATE TABLE sender_rules (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, address)
  );
  CREATE TABLE sent_contacts (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    last_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, address)
  );

  -- 8. Disiscrizioni e blocchi
  CREATE TABLE unsubscriptions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    list_id TEXT,
    method TEXT NOT NULL,            -- 'one-click' | 'mailto' | 'browser'
    target TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    prompted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE blocked_senders (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, address)
  );
  `,

  // v3 — nome del mittente salvato con la disiscrizione (le sue mail possono essere archiviate)
  `
  ALTER TABLE unsubscriptions ADD COLUMN name TEXT;
  `
]
