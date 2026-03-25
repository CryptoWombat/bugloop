-- Bugloop support tables
-- Run this migration in your Supabase project to set up Bugloop storage.

create table if not exists bugloop_tickets (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('question', 'bug', 'feature')),
  severity      text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status        text not null default 'open'
                  check (status in ('open', 'triaging', 'answering', 'investigating', 'fixing', 'deployed', 'resolved', 'wont_fix')),
  title         text not null,
  structured_report jsonb not null default '{}',
  agent_run_id  text,
  pr_url        text,
  user_id       text not null,
  user_email    text,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

create index if not exists idx_bugloop_tickets_user    on bugloop_tickets (user_id);
create index if not exists idx_bugloop_tickets_status  on bugloop_tickets (status);
create index if not exists idx_bugloop_tickets_type    on bugloop_tickets (type);
create index if not exists idx_bugloop_tickets_created on bugloop_tickets (created_at desc);

create table if not exists bugloop_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references bugloop_tickets (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant', 'system')),
  content     text not null,
  attachments jsonb not null default '[]',
  created_at  timestamptz not null default now()
);

create index if not exists idx_bugloop_messages_ticket on bugloop_messages (ticket_id, created_at);
