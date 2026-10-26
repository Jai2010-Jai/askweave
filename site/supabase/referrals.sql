-- Weave referrals. Run this once in Supabase → SQL Editor → New query → Run, after schema.sql.
-- Gives everyone a share code, records who invited whom, and lets people count their own invites.

-- Each person's code for their invite link (askweave.xyz/?ref=CODE), and who invited them.
alter table public.waitlist
  add column ref_code text unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  add column referred_by uuid references public.waitlist (id) on delete set null;

update public.waitlist set ref_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) where ref_code is null;
alter table public.waitlist alter column ref_code set not null;

create index waitlist_referred_by_idx on public.waitlist (referred_by);

-- Signing up now also records the invite code the person arrived with, if it belongs to someone.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.waitlist (id, email, name, building, lang, referred_by)
  values (
    new.id,
    new.email,
      left(coalesce(new.raw_user_meta_data ->> 'name', ''), 100),
    nullif(left(coalesce(new.raw_user_meta_data ->> 'building', ''), 500), ''),
    left(new.raw_user_meta_data ->> 'lang', 5),
    (select id from public.waitlist where ref_code = lower(left(new.raw_user_meta_data ->> 'ref', 16)))
  );
  return new;
end;
$$;

-- How many people joined with your link, without being able to see who they are.
create function public.my_referrals()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.waitlist where referred_by = (select auth.uid());
$$;

revoke execute on function public.my_referrals() from public, anon;
grant execute on function public.my_referrals() to authenticated;
