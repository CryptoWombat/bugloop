// ---------------------------------------------------------------------------
// Bugloop Supabase Migration SQL
// ---------------------------------------------------------------------------
// Exported as a string so the host app can include it in their Supabase
// migrations directory, or run it directly via the Supabase dashboard.
// ---------------------------------------------------------------------------

export const MIGRATION_SQL = /* sql */ `
-- Bugloop support tables
-- Prefix: bugloop_ (configurable in adapter, but migration uses default)

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

-- Storage bucket for attachments (Supabase Storage)
insert into storage.buckets (id, name, public)
values ('bugloop-attachments', 'bugloop-attachments', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload to the bugloop-attachments bucket
create policy "bugloop_upload" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'bugloop-attachments');

-- Allow public read access to bugloop attachments
create policy "bugloop_read" on storage.objects for select
  to public
  using (bucket_id = 'bugloop-attachments');

-- Optional: RLS policies (uncomment and customize for your auth setup)
-- alter table bugloop_tickets enable row level security;
-- alter table bugloop_messages enable row level security;
--
-- create policy "Users can view own tickets"
--   on bugloop_tickets for select
--   using (user_id = auth.uid()::text);
--
-- create policy "Users can create tickets"
--   on bugloop_tickets for insert
--   with check (user_id = auth.uid()::text);
--
-- create policy "Users can view messages on own tickets"
--   on bugloop_messages for select
--   using (ticket_id in (select id from bugloop_tickets where user_id = auth.uid()::text));
`

/** Also export as a plain .sql file path for migration tooling */
export const MIGRATION_FILENAME = 'bugloop_support_tables.sql'
