-- Weave waitlist. Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run once on a fresh project.

-- One row per person on the waitlist. The id is their login account's id.
create table public.waitlist (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '' check (char_length(name) <= 100),
  building text check (char_length(building) <= 500),
  lang text check (char_length(lang) <= 5),
  created_at timestamptz not null default now()
);

create index waitlist_created_at_idx on public.waitlist (created_at);

-- Row level security: people can only ever see and edit their own row.
alter table public.waitlist enable row level security;

create policy "Read own waitlist row" on public.waitlist
  for select to authenticated using ((select auth.uid()) = id);

create policy "Update own waitlist row" on public.waitlist
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Only the name and "what would you build" answer can be changed from the website.
revoke insert, update, delete on public.waitlist from anon, authenticated;
grant update (name, building) on public.waitlist to authenticated;

-- Signing up creates the waitlist row from the details sent with the sign-up.
-- This runs even when email confirmation is on and the person has no session yet.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.waitlist (id, email, name, building, lang)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'name', ''), 100),
    nullif(left(coalesce(new.raw_user_meta_data ->> 'building', ''), 500), ''),
    left(new.raw_user_meta_data ->> 'lang', 5)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Your place in line, without being able to see anyone else's row.
create function public.waitlist_position()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.waitlist w, public.waitlist me
  where me.id = (select auth.uid()) and w.created_at <= me.created_at;
$$;

-- Leave the waitlist: deletes the login account, which also deletes the waitlist row.
create function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid());
$$;

revoke execute on function public.waitlist_position() from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.waitlist_position() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
