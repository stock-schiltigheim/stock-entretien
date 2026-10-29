-- =====================================================================
-- Registres de sécurité – Secteur Est (Nelson Mandela, Aar, Canal)
-- À exécuter dans le MÊME projet Supabase que Stock Entretien :
-- Supabase > SQL Editor > New query > coller tout le fichier > Run.
-- Le script peut être relancé sans risque : il ne touche à aucune
-- donnée de Stock Entretien et ne recrée pas ce qui existe déjà.
--
-- Accès :
--  - le responsable de secteur (rôle « secteur » dans Stock Entretien)
--    est administrateur : il voit et modifie les trois registres et
--    choisit qui d'autre y a accès ;
--  - les autres comptes n'ont accès qu'aux sites que l'administrateur
--    leur a ouverts (table reg_acces).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.reg_sites (
  id                   text primary key check (id in ('mandela', 'aar', 'canal')),
  nom                  text not null,
  court                text not null,
  ordre                smallint not null,
  type_erp             text not null default '',
  categorie            text not null default '',
  effectif             text not null default '',
  derniere_commission  date,
  avis                 text not null default '' check (avis in ('', 'favorable', 'defavorable')),
  prochaine_commission date,
  updated_at           timestamptz not null default now()
);

-- Qui a accès à quels registres (hors administrateur)
create table if not exists public.reg_acces (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  sites      text[] not null default '{}'
             check (sites <@ array['mandela', 'aar', 'canal']::text[]),
  updated_at timestamptz not null default now()
);

-- Une rubrique du registre (A, B, C… YZ)
create table if not exists public.reg_rubriques (
  id          uuid primary key default gen_random_uuid(),
  site_id     text not null references public.reg_sites(id),
  lettre      text not null default '',
  nom         text not null check (length(trim(nom)) > 0),
  detail      text not null default '',
  ordre       integer not null default 0,
  dernier     date,
  intervenant text not null default '',
  resultat    text not null default '' check (resultat in ('', 'conforme', 'observations')),
  prochain    date,
  reference   text not null default '',
  maj_le      timestamptz,
  maj_par     uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists reg_rubriques_lettre
  on public.reg_rubriques (site_id, lettre) where lettre <> '';

-- Observations relevées dans les rapports
create table if not exists public.reg_observations (
  id          uuid primary key default gen_random_uuid(),
  rubrique_id uuid not null references public.reg_rubriques(id) on delete cascade,
  texte       text not null check (length(trim(texte)) > 0),
  levee       boolean not null default false,
  levee_le    date,
  levee_par   uuid references public.profiles(id) on delete set null,
  cree_le     timestamptz not null default now(),
  cree_par    uuid default auth.uid() references public.profiles(id) on delete set null
);
create index if not exists reg_observations_rubrique on public.reg_observations (rubrique_id);

-- Pièces jointes (le fichier lui-même est dans le stockage « registres »)
create table if not exists public.reg_pieces (
  id          uuid primary key default gen_random_uuid(),
  site_id     text not null references public.reg_sites(id),
  rubrique_id uuid references public.reg_rubriques(id) on delete set null,
  titre       text not null default '',
  nom_fichier text not null,
  chemin      text not null unique,
  type        text not null default '',
  taille      bigint not null default 0,
  ajoute_le   timestamptz not null default now(),
  ajoute_par  uuid default auth.uid() references public.profiles(id) on delete set null
);
create index if not exists reg_pieces_site on public.reg_pieces (site_id);

-- Passages d'entreprises extérieures, signés par l'intervenant.
-- Une fois signé, un passage ne se modifie plus ; seul l'administrateur
-- peut le supprimer.
create table if not exists public.reg_visites (
  id          uuid primary key default gen_random_uuid(),
  site_id     text not null references public.reg_sites(id),
  rubrique_id uuid references public.reg_rubriques(id) on delete set null,
  date_visite date not null default current_date,
  entreprise  text not null check (length(trim(entreprise)) > 0),
  intervenant text not null check (length(trim(intervenant)) > 0),
  objet       text not null default '',
  resultat    text not null default '' check (resultat in ('', 'conforme', 'observations')),
  remarques   text not null default '',
  signature   text not null unique,          -- image de la signature dans le stockage
  signe_le    timestamptz not null default now(),
  vise_par    uuid default auth.uid() references public.profiles(id) on delete set null
);
create index if not exists reg_visites_site on public.reg_visites (site_id, date_visite desc);

-- ---------------------------------------------------------------------
-- 2. FONCTIONS D'AIDE
-- ---------------------------------------------------------------------

create or replace function public.reg_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_secteur(), false)
$$;

-- Sites ouverts à la personne connectée (compte Stock Entretien actif)
create or replace function public.reg_mes_sites() returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when reg_is_admin() then array['mandela', 'aar', 'canal']::text[]
    else coalesce((select a.sites from reg_acces a
                   join profiles p on p.id = a.user_id
                   where a.user_id = auth.uid() and p.active), '{}'::text[])
  end
$$;

create or replace function public.reg_can(s text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(s = any(reg_mes_sites()), false)
$$;

create or replace function public.reg_site_de_rubrique(r uuid) returns text
language sql stable security definer set search_path = public as $$
  select site_id from reg_rubriques where id = r
$$;

-- Noms des personnes (pour « modifié par… ») et, pour l'administrateur,
-- la liste complète avec rôles et accès.
create or replace function public.reg_personnes()
returns table (id uuid, full_name text, role text, stock_site smallint, active boolean, sites text[])
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name,
         case when reg_is_admin() then p.role end,
         case when reg_is_admin() then p.site_id end,
         case when reg_is_admin() then p.active end,
         case when reg_is_admin() or p.id = auth.uid() then coalesce(a.sites, '{}'::text[]) end
  from profiles p
  left join reg_acces a on a.user_id = p.id
  where cardinality(reg_mes_sites()) > 0
  order by p.full_name
$$;

-- ---------------------------------------------------------------------
-- 3. AUTOMATISMES : qui a modifié quoi, et quand
-- ---------------------------------------------------------------------

create or replace function public.reg_stamp_rubrique() returns trigger
language plpgsql as $$
begin
  if new.site_id is distinct from old.site_id then
    raise exception 'Une rubrique ne peut pas changer de site.';
  end if;
  if (new.dernier, new.intervenant, new.resultat, new.prochain, new.reference)
     is distinct from (old.dernier, old.intervenant, old.resultat, old.prochain, old.reference) then
    new.maj_le := now();
    new.maj_par := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists reg_rubriques_stamp on public.reg_rubriques;
create trigger reg_rubriques_stamp before update on public.reg_rubriques
  for each row execute function public.reg_stamp_rubrique();

create or replace function public.reg_stamp_observation() returns trigger
language plpgsql as $$
begin
  if new.rubrique_id is distinct from old.rubrique_id then
    raise exception 'Une observation ne peut pas changer de rubrique.';
  end if;
  if new.levee and not old.levee then
    new.levee_le := current_date; new.levee_par := auth.uid();
  elsif not new.levee then
    new.levee_le := null; new.levee_par := null;
  end if;
  return new;
end $$;
drop trigger if exists reg_observations_stamp on public.reg_observations;
create trigger reg_observations_stamp before update on public.reg_observations
  for each row execute function public.reg_stamp_observation();

create or replace function public.reg_stamp_site() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists reg_sites_stamp on public.reg_sites;
create trigger reg_sites_stamp before update on public.reg_sites
  for each row execute function public.reg_stamp_site();

drop trigger if exists reg_acces_stamp on public.reg_acces;
create trigger reg_acces_stamp before update on public.reg_acces
  for each row execute function public.reg_stamp_site();

-- ---------------------------------------------------------------------
-- 4. SÉCURITÉ (chaque ligne n'est visible que des personnes autorisées)
-- ---------------------------------------------------------------------

alter table public.reg_sites        enable row level security;
alter table public.reg_acces        enable row level security;
alter table public.reg_rubriques    enable row level security;
alter table public.reg_observations enable row level security;
alter table public.reg_pieces       enable row level security;

grant select, update on public.reg_sites to authenticated;
grant select, insert, update, delete on public.reg_acces, public.reg_rubriques,
  public.reg_observations, public.reg_pieces to authenticated;
revoke all on public.reg_sites, public.reg_acces, public.reg_rubriques,
  public.reg_observations, public.reg_pieces from anon;
grant execute on function public.reg_is_admin(), public.reg_mes_sites(), public.reg_can(text),
  public.reg_site_de_rubrique(uuid), public.reg_personnes() to authenticated;

drop policy if exists reg_sites_lire on public.reg_sites;
create policy reg_sites_lire on public.reg_sites for select to authenticated using (reg_can(id));
drop policy if exists reg_sites_modifier on public.reg_sites;
create policy reg_sites_modifier on public.reg_sites for update to authenticated
  using (reg_can(id)) with check (reg_can(id));

drop policy if exists reg_acces_lire on public.reg_acces;
create policy reg_acces_lire on public.reg_acces for select to authenticated
  using (user_id = auth.uid() or reg_is_admin());
drop policy if exists reg_acces_gerer on public.reg_acces;
create policy reg_acces_gerer on public.reg_acces for all to authenticated
  using (reg_is_admin()) with check (reg_is_admin());

drop policy if exists reg_rubriques_tout on public.reg_rubriques;
create policy reg_rubriques_tout on public.reg_rubriques for all to authenticated
  using (reg_can(site_id)) with check (reg_can(site_id));

drop policy if exists reg_observations_tout on public.reg_observations;
create policy reg_observations_tout on public.reg_observations for all to authenticated
  using (reg_can(reg_site_de_rubrique(rubrique_id)))
  with check (reg_can(reg_site_de_rubrique(rubrique_id)));

drop policy if exists reg_pieces_lire on public.reg_pieces;
create policy reg_pieces_lire on public.reg_pieces for select to authenticated using (reg_can(site_id));
drop policy if exists reg_pieces_ajouter on public.reg_pieces;
create policy reg_pieces_ajouter on public.reg_pieces for insert to authenticated
  with check (reg_can(site_id) and ajoute_par = auth.uid()
              and split_part(chemin, '/', 1) = site_id
              and (rubrique_id is null or reg_site_de_rubrique(rubrique_id) = site_id));
drop policy if exists reg_pieces_modifier on public.reg_pieces;
create policy reg_pieces_modifier on public.reg_pieces for update to authenticated
  using (reg_can(site_id) and (reg_is_admin() or ajoute_par = auth.uid()))
  with check (reg_can(site_id) and split_part(chemin, '/', 1) = site_id);
drop policy if exists reg_pieces_retirer on public.reg_pieces;
create policy reg_pieces_retirer on public.reg_pieces for delete to authenticated
  using (reg_can(site_id) and (reg_is_admin() or ajoute_par = auth.uid()));

alter table public.reg_visites enable row level security;
grant select, insert, delete on public.reg_visites to authenticated;
revoke all on public.reg_visites from anon;
drop policy if exists reg_visites_lire on public.reg_visites;
create policy reg_visites_lire on public.reg_visites for select to authenticated using (reg_can(site_id));
drop policy if exists reg_visites_ajouter on public.reg_visites;
create policy reg_visites_ajouter on public.reg_visites for insert to authenticated
  with check (reg_can(site_id) and vise_par = auth.uid()
              and split_part(signature, '/', 1) = site_id
              and (rubrique_id is null or reg_site_de_rubrique(rubrique_id) = site_id));
drop policy if exists reg_visites_supprimer on public.reg_visites;
create policy reg_visites_supprimer on public.reg_visites for delete to authenticated
  using (reg_is_admin());

-- ---------------------------------------------------------------------
-- 5. STOCKAGE DES PIÈCES JOINTES (privé, 20 Mo, PDF et photos)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('registres', 'registres', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "registres lire" on storage.objects;
create policy "registres lire" on storage.objects for select to authenticated
  using (bucket_id = 'registres' and reg_can(split_part(name, '/', 1)));
drop policy if exists "registres ajouter" on storage.objects;
create policy "registres ajouter" on storage.objects for insert to authenticated
  with check (bucket_id = 'registres' and reg_can(split_part(name, '/', 1)));
drop policy if exists "registres retirer" on storage.objects;
create policy "registres retirer" on storage.objects for delete to authenticated
  using (bucket_id = 'registres' and reg_can(split_part(name, '/', 1))
         and (reg_is_admin()
              or (not exists (select 1 from public.reg_visites v where v.signature = objects.name)
                  and (not exists (select 1 from public.reg_pieces x where x.chemin = objects.name)
                       or exists (select 1 from public.reg_pieces x where x.chemin = objects.name and x.ajoute_par = auth.uid())))));

-- ---------------------------------------------------------------------
-- 6. CONTENU DE DÉPART : les trois sites et leurs rubriques
-- ---------------------------------------------------------------------

insert into public.reg_sites (id, nom, court, ordre, type_erp, categorie, effectif) values
  ('mandela', 'Centre sportif Nelson Mandela', 'Nelson Mandela', 1, 'X', '1re catégorie', '1 860'),
  ('aar',     'Stade de l''Aar',              'Stade de l''Aar', 2, '', '', ''),
  ('canal',   'Stade du Canal',               'Stade du Canal',  3, '', '', '')
on conflict (id) do nothing;

with modele (lettre, ordre, nom, detail, stades_seulement) as (values
  ('A',  1,  'Renseignements sur l''établissement', 'Plans · Consignes', false),
  ('B',  2,  'Contrôles et visites', 'Commission de sécurité, rapports · Inspection du travail · Organismes divers', false),
  ('C',  3,  'Contrôle des installations électriques', '', false),
  ('D',  4,  'Contrôle des installations gaz', '', false),
  ('E',  5,  'SSI – Moyens de secours sécurité incendie', '', false),
  ('F',  6,  'Contrôle des extincteurs et RIA', '', false),
  ('G',  7,  'Maintenance et vérification désenfumage', '', false),
  ('H',  8,  'Contrôle des ascenseurs, élévateurs…', '', false),
  ('IJ', 9,  'Contrôle des installations gaz chaufferie', '', false),
  ('KL', 10, 'Contrôle des conduits de fumée', '', false),
  ('M',  11, 'Contrôle des appareils de cuisson (gaz ou autre)', '', false),
  ('N',  12, 'Dégraissage des hottes de cuisine', '', false),
  ('O',  13, 'Dossier technique amiante', '', false),
  ('P',  14, 'Contrôle système de protection foudre', '', false),
  ('QR', 15, 'Ligne de vie', '', false),
  ('S',  16, 'Information réglementaire générale', '', false),
  ('T',  17, 'Tribunes (structure, garde-corps, escaliers)', '', true),
  ('U',  18, 'Éclairage du terrain (mâts et projecteurs)', '', true),
  ('V',  19, 'Buts, main courante et équipements sportifs', '', true),
  ('WX', 20, 'Formation du personnel et exercices', '', false),
  ('YZ', 21, 'PV des matériaux de construction', '', false))
insert into public.reg_rubriques (site_id, lettre, ordre, nom, detail)
select s.id, m.lettre, m.ordre, m.nom, m.detail
from public.reg_sites s cross join modele m
where not m.stades_seulement or s.id in ('aar', 'canal')
on conflict (site_id, lettre) where lettre <> '' do nothing;

-- Fin. Message attendu : « Success. No rows returned ».
