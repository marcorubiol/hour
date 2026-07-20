-- Conversations v1.5: contact timestamps are a database invariant.
--
-- A real status transition represents an interaction, while the explicit
-- "contacted today" action updates last_contacted_at directly. In both cases
-- first_contacted_at is set once and then preserved. Keeping this in a BEFORE
-- trigger makes API and future trusted ingress paths agree atomically.

create or replace function public.maintain_conversation_contact_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.last_contacted_at := statement_timestamp();
  end if;

  if tg_op = 'UPDATE' and old.first_contacted_at is not null then
    new.first_contacted_at := old.first_contacted_at;
  elsif new.last_contacted_at is not null then
    new.first_contacted_at := coalesce(new.first_contacted_at, new.last_contacted_at);
  end if;

  return new;
end;
$$;

comment on function public.maintain_conversation_contact_timestamps() is
  'Keeps first/last contact stamps atomic: status transitions touch last; first is write-once.';

drop trigger if exists conversation_contact_timestamps on public.conversation;
create trigger conversation_contact_timestamps
before insert or update on public.conversation
for each row execute function public.maintain_conversation_contact_timestamps();
