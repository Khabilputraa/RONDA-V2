-- ============================================================
-- RONDA App — SETUP LENGKAP DATABASE (sekali jalan)
-- ============================================================
-- Cara pakai (Opsi B — Supabase sendiri):
--   1. Buat project baru di https://supabase.com (catat URL + anon key).
--   2. Buka: SQL Editor -> New query.
--   3. Paste SELURUH isi file ini, klik RUN.
--   4. Isi mobile/.env dengan URL + anon key project Anda, lalu jalankan app.
--
-- File ini = prelude (tabel `profiles` yang tidak ada di migrasi) + seluruh
-- migrasi 001..013 (urut). Storage bucket (announcement-images, profile-avatars,
-- iuran-payment-proofs) sudah otomatis dibuat oleh migrasi 006/010/013.
-- Aman dijalankan pada database Supabase yang MASIH KOSONG.
-- ============================================================

-- ── PRELUDE: tabel profiles ─────────────────────────────────
-- Tidak ada di migrasi bernomor (di project lama dibuat terpisah).
-- role = TEXT (di 008 di-cast ::user_role); RLS diaktifkan agar policy
-- dari migrasi 002/003 berlaku. Kolom rt_id & avatar_url ditambah oleh
-- migrasi 001 & 010 (ADD COLUMN IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  phone       TEXT,
  role        TEXT NOT NULL DEFAULT 'warga',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================


-- ==================== 001_rt_roles_schema.sql ====================

-- ============================================================
-- RONDA App — Schema RT, Roles & Keamanan
-- Jalankan di Supabase SQL Editor atau via supabase db push
-- ============================================================

-- ── Enum role ────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('ketua_rt', 'bendahara', 'warga');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Tabel RT ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rt_units (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  rt_number     TEXT NOT NULL,
  rw_number     TEXT,
  address       TEXT,
  invite_code   TEXT NOT NULL UNIQUE,
  ketua_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  member_count  INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rt_units_invite_code ON public.rt_units(invite_code);
CREATE INDEX IF NOT EXISTS idx_rt_units_ketua_id ON public.rt_units(ketua_id);

-- ── Perluas profiles ─────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rt_id UUID REFERENCES public.rt_units(id) ON DELETE SET NULL;

-- Pastikan kolom role ada; default warga untuk user baru
ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'warga';

-- ── Pengumuman ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rt_id       UUID NOT NULL REFERENCES public.rt_units(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_pinned   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_rt_id ON public.announcements(rt_id);

-- ── Kas RT (transaksi) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kas_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rt_id         UUID NOT NULL REFERENCES public.rt_units(id) ON DELETE CASCADE,
  recorded_by   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('masuk', 'keluar')),
  amount        NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  description   TEXT NOT NULL,
  category      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kas_transactions_rt_id ON public.kas_transactions(rt_id);

-- ── Helper: generate kode undangan ────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- ── Trigger: auto-create profile saat signup ─────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, role, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Pengguna'),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    'warga',
    TRUE
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── RPC: Buat RT Baru (auto jadi Ketua RT) ───────────────────
CREATE OR REPLACE FUNCTION public.create_rt_unit(
  p_name TEXT,
  p_rt_number TEXT,
  p_rw_number TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_code TEXT;
  v_rt_id UUID;
  v_attempts INT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  IF v_profile.rt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Anda sudah tergabung dalam RT';
  END IF;

  IF v_profile.role NOT IN ('warga') THEN
    RAISE EXCEPTION 'Hanya warga tanpa RT yang bisa membuat RT baru';
  END IF;

  -- Generate kode unik
  LOOP
    v_code := public.generate_invite_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rt_units WHERE invite_code = v_code);
    v_attempts := v_attempts + 1;
    IF v_attempts > 20 THEN
      RAISE EXCEPTION 'Gagal generate kode undangan';
    END IF;
  END LOOP;

  INSERT INTO public.rt_units (name, rt_number, rw_number, address, invite_code, ketua_id)
  VALUES (p_name, p_rt_number, p_rw_number, p_address, v_code, v_user_id)
  RETURNING id INTO v_rt_id;

  UPDATE public.profiles
  SET role = 'ketua_rt', rt_id = v_rt_id
  WHERE id = v_user_id;

  RETURN json_build_object(
    'rt_id', v_rt_id,
    'invite_code', v_code,
    'role', 'ketua_rt'
  );
END;
$$;

-- ── RPC: Gabung RT via kode undangan ─────────────────────────
CREATE OR REPLACE FUNCTION public.join_rt_by_code(p_invite_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_rt RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  IF v_profile.rt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Anda sudah tergabung dalam RT';
  END IF;

  SELECT * INTO v_rt
  FROM public.rt_units
  WHERE UPPER(invite_code) = UPPER(TRIM(p_invite_code));

  IF v_rt IS NULL THEN
    RAISE EXCEPTION 'Kode undangan tidak valid';
  END IF;

  UPDATE public.profiles
  SET role = 'warga', rt_id = v_rt.id
  WHERE id = v_user_id;

  UPDATE public.rt_units
  SET member_count = member_count + 1, updated_at = NOW()
  WHERE id = v_rt.id;

  RETURN json_build_object(
    'rt_id', v_rt.id,
    'rt_name', v_rt.name,
    'role', 'warga'
  );
END;
$$;

-- ── RPC: Ketua RT tunjuk Bendahara ───────────────────────────
CREATE OR REPLACE FUNCTION public.appoint_bendahara(p_warga_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ketua_id UUID := auth.uid();
  v_ketua RECORD;
  v_warga RECORD;
  v_existing_bendahara UUID;
BEGIN
  IF v_ketua_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_ketua FROM public.profiles WHERE id = v_ketua_id;

  IF v_ketua.role != 'ketua_rt' THEN
    RAISE EXCEPTION 'Hanya Ketua RT yang bisa menunjuk Bendahara';
  END IF;

  IF v_ketua.rt_id IS NULL THEN
    RAISE EXCEPTION 'Ketua RT belum memiliki RT';
  END IF;

  SELECT * INTO v_warga FROM public.profiles WHERE id = p_warga_id;

  IF v_warga IS NULL OR v_warga.rt_id != v_ketua.rt_id THEN
    RAISE EXCEPTION 'Warga tidak ditemukan di RT Anda';
  END IF;

  IF v_warga.role != 'warga' THEN
    RAISE EXCEPTION 'Hanya warga yang bisa ditunjuk jadi Bendahara';
  END IF;

  -- Turunkan bendahara lama ke warga (maks 1 bendahara per RT)
  SELECT id INTO v_existing_bendahara
  FROM public.profiles
  WHERE rt_id = v_ketua.rt_id AND role = 'bendahara' AND id != p_warga_id
  LIMIT 1;

  IF v_existing_bendahara IS NOT NULL THEN
    UPDATE public.profiles SET role = 'warga' WHERE id = v_existing_bendahara;
  END IF;

  UPDATE public.profiles SET role = 'bendahara' WHERE id = p_warga_id;

  RETURN json_build_object('bendahara_id', p_warga_id, 'role', 'bendahara');
END;
$$;

-- ── RPC: Ketua RT cabut Bendahara ────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_bendahara(p_bendahara_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ketua_id UUID := auth.uid();
  v_ketua RECORD;
  v_bendahara RECORD;
BEGIN
  IF v_ketua_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_ketua FROM public.profiles WHERE id = v_ketua_id;

  IF v_ketua.role != 'ketua_rt' THEN
    RAISE EXCEPTION 'Hanya Ketua RT yang bisa mencabut Bendahara';
  END IF;

  SELECT * INTO v_bendahara FROM public.profiles WHERE id = p_bendahara_id;

  IF v_bendahara IS NULL OR v_bendahara.rt_id != v_ketua.rt_id OR v_bendahara.role != 'bendahara' THEN
    RAISE EXCEPTION 'Bendahara tidak ditemukan di RT Anda';
  END IF;

  UPDATE public.profiles SET role = 'warga' WHERE id = p_bendahara_id;

  RETURN json_build_object('bendahara_id', p_bendahara_id, 'role', 'warga');
END;
$$;

-- ── View: saldo kas per RT ─────────────────────────────────────
CREATE OR REPLACE VIEW public.rt_kas_summary AS
SELECT
  rt_id,
  COALESCE(SUM(CASE WHEN type = 'masuk' THEN amount ELSE 0 END), 0) AS total_masuk,
  COALESCE(SUM(CASE WHEN type = 'keluar' THEN amount ELSE 0 END), 0) AS total_keluar,
  COALESCE(SUM(CASE WHEN type = 'masuk' THEN amount ELSE -amount END), 0) AS saldo
FROM public.kas_transactions
GROUP BY rt_id;

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE public.rt_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kas_transactions ENABLE ROW LEVEL SECURITY;

-- RT: anggota RT bisa lihat RT mereka
CREATE POLICY "rt_select_members" ON public.rt_units
  FOR SELECT USING (
    id IN (SELECT rt_id FROM public.profiles WHERE id = auth.uid())
    OR ketua_id = auth.uid()
  );

CREATE POLICY "rt_update_ketua" ON public.rt_units
  FOR UPDATE USING (ketua_id = auth.uid());

-- Pengumuman: anggota RT bisa baca, ketua/bendahara bisa tulis
CREATE POLICY "announcements_select" ON public.announcements
  FOR SELECT USING (
    rt_id IN (SELECT rt_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "announcements_insert" ON public.announcements
  FOR INSERT WITH CHECK (
    rt_id IN (
      SELECT rt_id FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ketua_rt', 'bendahara')
    )
    AND author_id = auth.uid()
  );

CREATE POLICY "announcements_delete_ketua" ON public.announcements
  FOR DELETE USING (
    rt_id IN (
      SELECT rt_id FROM public.profiles
      WHERE id = auth.uid() AND role = 'ketua_rt'
    )
  );

-- Kas: ketua & bendahara kelola, warga baca
CREATE POLICY "kas_select_members" ON public.kas_transactions
  FOR SELECT USING (
    rt_id IN (SELECT rt_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "kas_insert_officers" ON public.kas_transactions
  FOR INSERT WITH CHECK (
    rt_id IN (
      SELECT rt_id FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ketua_rt', 'bendahara')
    )
    AND recorded_by = auth.uid()
  );

-- Profiles: anggota RT sama bisa lihat profil satu sama lain
CREATE POLICY "profiles_select_same_rt" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR rt_id IN (SELECT p.rt_id FROM public.profiles p WHERE p.id = auth.uid() AND p.rt_id IS NOT NULL)
  );

-- Lindungi kolom role & rt_id dari update langsung client
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.id THEN
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.rt_id IS DISTINCT FROM OLD.rt_id THEN
      RAISE EXCEPTION 'Role dan RT hanya bisa diubah melalui fungsi resmi';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_role_trigger ON public.profiles;
CREATE TRIGGER protect_profile_role_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();

-- Grant execute RPC ke authenticated users
GRANT EXECUTE ON FUNCTION public.create_rt_unit TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_rt_by_code TO authenticated;
GRANT EXECUTE ON FUNCTION public.appoint_bendahara TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_bendahara TO authenticated;


-- ==================== 002_profiles_fix.sql ====================

-- ============================================================
-- Fix: Profil tidak ditemukan setelah login
-- Jalankan SETELAH 001_rt_roles_schema.sql
-- ============================================================

-- 1. Backfill profil untuk user auth yang belum punya baris profiles
INSERT INTO public.profiles (id, full_name, phone, role, is_active)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', 'Pengguna'),
  COALESCE(u.raw_user_meta_data->>'phone', ''),
  'warga',
  TRUE
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- 2. Policy: user boleh baca & buat profil sendiri
DO $$ BEGIN
  CREATE POLICY "profiles_select_own" ON public.profiles
    FOR SELECT USING (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "profiles_insert_own" ON public.profiles
    FOR INSERT WITH CHECK (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "profiles_update_own" ON public.profiles
    FOR UPDATE USING (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. RPC: pastikan profil ada (dipanggil dari app jika perlu)
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user RECORD;
  v_profile RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF v_profile IS NOT NULL THEN
    RETURN row_to_json(v_profile)::json;
  END IF;

  SELECT * INTO v_user FROM auth.users WHERE id = v_user_id;

  INSERT INTO public.profiles (id, full_name, phone, role, is_active)
  VALUES (
    v_user_id,
    COALESCE(v_user.raw_user_meta_data->>'full_name', 'Pengguna'),
    COALESCE(v_user.raw_user_meta_data->>'phone', ''),
    'warga',
    TRUE
  );

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  RETURN row_to_json(v_profile)::json;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_my_profile TO authenticated;


-- ==================== 003_fix_profiles_rls.sql ====================

-- ============================================================
-- Fix RLS profiles (sering bikin SELECT profil selalu kosong)
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- Hapus policy yang bisa rekursif / bentrok
DROP POLICY IF EXISTS "profiles_select_same_rt" ON public.profiles;

-- Helper baca rt_id tanpa kena RLS rekursif
CREATE OR REPLACE FUNCTION public.current_user_rt_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rt_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Wajib: tanpa EXECUTE, evaluasi policy profiles_select_rt_members gagal
-- sehingga Ketua hanya bisa membaca profilnya sendiri (warga se-RT tak muncul).
GRANT EXECUTE ON FUNCTION public.current_user_rt_id() TO authenticated;

-- Policy SELECT: selalu boleh baca profil sendiri + anggota RT yang sama
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_select_rt_members" ON public.profiles;
CREATE POLICY "profiles_select_rt_members" ON public.profiles
  FOR SELECT USING (
    rt_id IS NOT NULL
    AND rt_id = public.current_user_rt_id()
  );

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- Backfill ulang (aman di-run berkali-kali)
INSERT INTO public.profiles (id, full_name, phone, role, is_active)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', 'Pengguna'),
  COALESCE(u.raw_user_meta_data->>'phone', ''),
  'warga',
  TRUE
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- Perkuat RPC ensure (bypass RLS)
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user RECORD;
  v_profile RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF FOUND THEN
    RETURN row_to_json(v_profile)::json;
  END IF;

  SELECT * INTO v_user FROM auth.users WHERE id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User auth tidak ditemukan';
  END IF;

  INSERT INTO public.profiles (id, full_name, phone, role, is_active)
  VALUES (
    v_user_id,
    COALESCE(v_user.raw_user_meta_data->>'full_name', 'Pengguna'),
    COALESCE(v_user.raw_user_meta_data->>'phone', ''),
    'warga',
    TRUE
  );

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  RETURN row_to_json(v_profile)::json;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_my_profile TO authenticated;

-- CEK: harus tampil baris user + profil (bukan kosong semua)
SELECT
  u.email,
  u.id AS auth_id,
  p.id AS profile_id,
  p.full_name,
  p.role
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at DESC;


-- ==================== 004_fix_role_trigger.sql ====================

-- ============================================================
-- Fix: "Role dan RT hanya bisa diubah melalui fungsi resmi"
-- Trigger lama memblokir RPC create_rt_unit / join_rt juga.
-- Jalankan di Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Izinkan perubahan role/rt_id dari RPC resmi (SECURITY DEFINER)
  IF current_setting('ronda.allow_role_change', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.id THEN
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.rt_id IS DISTINCT FROM OLD.rt_id THEN
      RAISE EXCEPTION 'Role dan RT hanya bisa diubah melalui fungsi resmi';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── create_rt_unit (dengan bypass trigger) ───────────────────
CREATE OR REPLACE FUNCTION public.create_rt_unit(
  p_name TEXT,
  p_rt_number TEXT,
  p_rw_number TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_code TEXT;
  v_rt_id UUID;
  v_attempts INT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil tidak ditemukan';
  END IF;

  IF v_profile.rt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Anda sudah tergabung dalam RT';
  END IF;

  IF v_profile.role NOT IN ('warga', 'petugas') THEN
    RAISE EXCEPTION 'Hanya warga tanpa RT yang bisa membuat RT baru';
  END IF;

  LOOP
    v_code := public.generate_invite_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rt_units WHERE invite_code = v_code);
    v_attempts := v_attempts + 1;
    IF v_attempts > 20 THEN
      RAISE EXCEPTION 'Gagal generate kode undangan';
    END IF;
  END LOOP;

  INSERT INTO public.rt_units (name, rt_number, rw_number, address, invite_code, ketua_id)
  VALUES (p_name, p_rt_number, p_rw_number, p_address, v_code, v_user_id)
  RETURNING id INTO v_rt_id;

  PERFORM set_config('ronda.allow_role_change', 'true', true);
  UPDATE public.profiles
  SET role = 'ketua_rt', rt_id = v_rt_id
  WHERE id = v_user_id;
  PERFORM set_config('ronda.allow_role_change', 'false', true);

  RETURN json_build_object(
    'rt_id', v_rt_id,
    'invite_code', v_code,
    'role', 'ketua_rt'
  );
END;
$$;

-- ── join_rt_by_code ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_rt_by_code(p_invite_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_rt RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  IF v_profile.rt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Anda sudah tergabung dalam RT';
  END IF;

  SELECT * INTO v_rt
  FROM public.rt_units
  WHERE UPPER(invite_code) = UPPER(TRIM(p_invite_code));

  IF v_rt IS NULL THEN
    RAISE EXCEPTION 'Kode undangan tidak valid';
  END IF;

  PERFORM set_config('ronda.allow_role_change', 'true', true);
  UPDATE public.profiles
  SET role = 'warga', rt_id = v_rt.id
  WHERE id = v_user_id;
  PERFORM set_config('ronda.allow_role_change', 'false', true);

  UPDATE public.rt_units
  SET member_count = member_count + 1, updated_at = NOW()
  WHERE id = v_rt.id;

  RETURN json_build_object(
    'rt_id', v_rt.id,
    'rt_name', v_rt.name,
    'role', 'warga'
  );
END;
$$;

-- ── appoint_bendahara ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.appoint_bendahara(p_warga_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ketua_id UUID := auth.uid();
  v_ketua RECORD;
  v_warga RECORD;
  v_existing_bendahara UUID;
BEGIN
  IF v_ketua_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_ketua FROM public.profiles WHERE id = v_ketua_id;

  IF v_ketua.role != 'ketua_rt' THEN
    RAISE EXCEPTION 'Hanya Ketua RT yang bisa menunjuk Bendahara';
  END IF;

  SELECT * INTO v_warga FROM public.profiles WHERE id = p_warga_id;

  IF v_warga IS NULL OR v_warga.rt_id != v_ketua.rt_id OR v_warga.role != 'warga' THEN
    RAISE EXCEPTION 'Warga tidak ditemukan di RT Anda';
  END IF;

  SELECT id INTO v_existing_bendahara
  FROM public.profiles
  WHERE rt_id = v_ketua.rt_id AND role = 'bendahara' AND id != p_warga_id
  LIMIT 1;

  PERFORM set_config('ronda.allow_role_change', 'true', true);

  IF v_existing_bendahara IS NOT NULL THEN
    UPDATE public.profiles SET role = 'warga' WHERE id = v_existing_bendahara;
  END IF;

  UPDATE public.profiles SET role = 'bendahara' WHERE id = p_warga_id;

  PERFORM set_config('ronda.allow_role_change', 'false', true);

  RETURN json_build_object('bendahara_id', p_warga_id, 'role', 'bendahara');
END;
$$;

-- ── revoke_bendahara ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_bendahara(p_bendahara_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ketua_id UUID := auth.uid();
  v_ketua RECORD;
  v_bendahara RECORD;
BEGIN
  IF v_ketua_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_ketua FROM public.profiles WHERE id = v_ketua_id;
  SELECT * INTO v_bendahara FROM public.profiles WHERE id = p_bendahara_id;

  IF v_bendahara IS NULL OR v_bendahara.rt_id != v_ketua.rt_id OR v_bendahara.role != 'bendahara' THEN
    RAISE EXCEPTION 'Bendahara tidak ditemukan di RT Anda';
  END IF;

  PERFORM set_config('ronda.allow_role_change', 'true', true);
  UPDATE public.profiles SET role = 'warga' WHERE id = p_bendahara_id;
  PERFORM set_config('ronda.allow_role_change', 'false', true);

  RETURN json_build_object('bendahara_id', p_bendahara_id, 'role', 'warga');
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_rt_unit TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_rt_by_code TO authenticated;
GRANT EXECUTE ON FUNCTION public.appoint_bendahara TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_bendahara TO authenticated;


-- ==================== 005_features_schema.sql ====================

-- ============================================================
-- Fitur jalan: Iuran, Kas (CRUD), Pengumuman, Surat
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- ── Iuran ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.iuran_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rt_id         UUID NOT NULL REFERENCES public.rt_units(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_key    TEXT NOT NULL,
  period_label  TEXT NOT NULL,
  amount        NUMERIC(15, 2) NOT NULL DEFAULT 50000,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rt_id, user_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_iuran_rt ON public.iuran_records(rt_id);
CREATE INDEX IF NOT EXISTS idx_iuran_user ON public.iuran_records(user_id);

-- ── Surat pengantar ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.surat_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rt_id       UUID NOT NULL REFERENCES public.rt_units(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  surat_type  TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_surat_rt ON public.surat_requests(rt_id);

-- ── RLS Iuran ─────────────────────────────────────────────────
ALTER TABLE public.iuran_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iuran_select_rt" ON public.iuran_records;
CREATE POLICY "iuran_select_rt" ON public.iuran_records
  FOR SELECT USING (
    rt_id IN (SELECT rt_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "iuran_insert_system" ON public.iuran_records;
CREATE POLICY "iuran_insert_rt" ON public.iuran_records
  FOR INSERT WITH CHECK (
    rt_id IN (
      SELECT rt_id FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ketua_rt', 'bendahara')
    )
  );

DROP POLICY IF EXISTS "iuran_update_own" ON public.iuran_records;
CREATE POLICY "iuran_update_own" ON public.iuran_records
  FOR UPDATE USING (
    user_id = auth.uid()
    OR rt_id IN (
      SELECT rt_id FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ketua_rt', 'bendahara')
    )
  );

-- ── RLS Surat ─────────────────────────────────────────────────
ALTER TABLE public.surat_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "surat_select" ON public.surat_requests;
CREATE POLICY "surat_select" ON public.surat_requests
  FOR SELECT USING (
    user_id = auth.uid()
    OR rt_id IN (
      SELECT rt_id FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ketua_rt', 'bendahara')
    )
  );

DROP POLICY IF EXISTS "surat_insert" ON public.surat_requests;
CREATE POLICY "surat_insert" ON public.surat_requests
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND rt_id IN (SELECT rt_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "surat_update_ketua" ON public.surat_requests;
CREATE POLICY "surat_update_ketua" ON public.surat_requests
  FOR UPDATE USING (
    rt_id IN (
      SELECT rt_id FROM public.profiles
      WHERE id = auth.uid() AND role = 'ketua_rt'
    )
  );

-- ── RPC: generate tagihan bulan ini untuk semua warga ───────────
CREATE OR REPLACE FUNCTION public.ensure_monthly_iuran(
  p_amount NUMERIC DEFAULT 50000
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rt_id UUID;
  v_role TEXT;
  v_period_key TEXT := to_char(NOW(), 'YYYY-MM');
  v_period_label TEXT;
  v_count INT;
BEGIN
  SELECT rt_id, role INTO v_rt_id, v_role
  FROM public.profiles WHERE id = auth.uid();

  IF v_rt_id IS NULL THEN
    RAISE EXCEPTION 'Anda belum tergabung RT';
  END IF;

  IF v_role NOT IN ('ketua_rt', 'bendahara') THEN
    RAISE EXCEPTION 'Hanya Ketua/Bendahara yang bisa generate tagihan';
  END IF;

  v_period_label := trim(to_char(NOW(), 'TMMonth YYYY'));

  INSERT INTO public.iuran_records (rt_id, user_id, period_key, period_label, amount)
  SELECT v_rt_id, p.id, v_period_key, v_period_label, p_amount
  FROM public.profiles p
  WHERE p.rt_id = v_rt_id AND p.role = 'warga'
  ON CONFLICT (rt_id, user_id, period_key) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Tagihan bulan ini untuk diri sendiri (warga / uji coba solo)
CREATE OR REPLACE FUNCTION public.ensure_my_iuran(
  p_amount NUMERIC DEFAULT 50000
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rt_id UUID;
  v_period_key TEXT := to_char(NOW(), 'YYYY-MM');
  v_period_label TEXT := trim(to_char(NOW(), 'TMMonth YYYY'));
  v_id UUID;
BEGIN
  SELECT rt_id INTO v_rt_id FROM public.profiles WHERE id = auth.uid();
  IF v_rt_id IS NULL THEN RAISE EXCEPTION 'Anda belum tergabung RT'; END IF;

  INSERT INTO public.iuran_records (rt_id, user_id, period_key, period_label, amount)
  VALUES (v_rt_id, auth.uid(), v_period_key, v_period_label, p_amount)
  ON CONFLICT (rt_id, user_id, period_key) DO UPDATE SET period_label = EXCLUDED.period_label
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── RPC: bayar iuran (warga) + catat ke kas ─────────────────────
CREATE OR REPLACE FUNCTION public.pay_iuran(p_iuran_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row public.iuran_records%ROWTYPE;
  v_name TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_row FROM public.iuran_records WHERE id = p_iuran_id FOR UPDATE;

  IF v_row IS NULL OR v_row.user_id != v_user THEN
    RAISE EXCEPTION 'Tagihan tidak ditemukan';
  END IF;

  IF v_row.status = 'paid' THEN
    RAISE EXCEPTION 'Tagihan sudah lunas';
  END IF;

  UPDATE public.iuran_records
  SET status = 'paid', paid_at = NOW()
  WHERE id = p_iuran_id;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_user;

  INSERT INTO public.kas_transactions (rt_id, recorded_by, type, amount, description, category)
  VALUES (
    v_row.rt_id, v_user, 'masuk', v_row.amount,
    'Iuran ' || v_row.period_label || ' — ' || COALESCE(v_name, 'Warga'),
    'iuran'
  );

  RETURN json_build_object('status', 'paid', 'iuran_id', p_iuran_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_monthly_iuran TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_iuran TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_iuran TO authenticated;


-- ==================== 006_announcement_media.sql ====================

-- ============================================================
-- Pengumuman: tanggal kegiatan + foto + storage
-- Jalankan di Supabase SQL Editor
-- ============================================================

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS event_date DATE,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ── Storage bucket (foto lokasi kerja bakti, dll.) ────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'announcement-images',
  'announcement-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Hapus policy lama jika re-run
DROP POLICY IF EXISTS "announcement_images_public_read" ON storage.objects;
DROP POLICY IF EXISTS "announcement_images_officer_upload" ON storage.objects;
DROP POLICY IF EXISTS "announcement_images_officer_update" ON storage.objects;
DROP POLICY IF EXISTS "announcement_images_officer_delete" ON storage.objects;

-- Semua orang bisa lihat (URL publik)
CREATE POLICY "announcement_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'announcement-images');

-- Ketua / Bendahara boleh upload
CREATE POLICY "announcement_images_officer_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'announcement-images'
    AND auth.uid() IN (
      SELECT id FROM public.profiles
      WHERE role IN ('ketua_rt', 'bendahara')
    )
  );

CREATE POLICY "announcement_images_officer_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'announcement-images'
    AND auth.uid() IN (
      SELECT id FROM public.profiles
      WHERE role IN ('ketua_rt', 'bendahara')
    )
  );

CREATE POLICY "announcement_images_officer_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'announcement-images'
    AND auth.uid() IN (
      SELECT id FROM public.profiles
      WHERE role IN ('ketua_rt', 'bendahara')
    )
  );


-- ==================== 007_warga_import_registry.sql ====================

-- ============================================================
-- Import data warga + auto-mapping saat login (tanpa kode)
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- Normalisasi nomor (sama seperti app: +62...)
CREATE OR REPLACE FUNCTION public.normalize_phone_id(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  p TEXT;
BEGIN
  p := regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g');
  IF p LIKE '62%' THEN p := substring(p FROM 3); END IF;
  IF p LIKE '0%' THEN p := substring(p FROM 2); END IF;
  IF p = '' THEN RETURN ''; END IF;
  RETURN '+62' || p;
END;
$$;

-- Daftar warga yang di-import Ketua (belum punya akun / belum login)
CREATE TABLE IF NOT EXISTS public.rt_warga_registry (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rt_id         UUID NOT NULL REFERENCES public.rt_units(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT,
  blok_rumah    TEXT,
  claimed_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at    TIMESTAMPTZ,
  imported_by   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rt_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_registry_rt ON public.rt_warga_registry(rt_id);
CREATE INDEX IF NOT EXISTS idx_registry_phone ON public.rt_warga_registry(phone);

ALTER TABLE public.rt_warga_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "registry_select_rt" ON public.rt_warga_registry;
CREATE POLICY "registry_select_rt" ON public.rt_warga_registry
  FOR SELECT USING (
    rt_id IN (SELECT rt_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "registry_manage_ketua" ON public.rt_warga_registry;
CREATE POLICY "registry_manage_ketua" ON public.rt_warga_registry
  FOR ALL USING (
    rt_id IN (
      SELECT rt_id FROM public.profiles
      WHERE id = auth.uid() AND role = 'ketua_rt'
    )
  );

-- ── Auto gabung RT jika nomor HP ada di registry ────────────────
CREATE OR REPLACE FUNCTION public.try_auto_join_rt()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_reg public.rt_warga_registry%ROWTYPE;
  v_phone TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF v_profile.rt_id IS NOT NULL THEN
    RETURN json_build_object('joined', false, 'reason', 'already_in_rt');
  END IF;

  v_phone := public.normalize_phone_id(COALESCE(v_profile.phone, ''));
  IF v_phone = '' OR v_phone = '+62' THEN
    RETURN json_build_object('joined', false, 'reason', 'no_phone');
  END IF;

  SELECT * INTO v_reg
  FROM public.rt_warga_registry
  WHERE phone = v_phone AND claimed_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_reg IS NULL THEN
    RETURN json_build_object('joined', false, 'reason', 'not_in_registry');
  END IF;

  UPDATE public.profiles
  SET
    rt_id = v_reg.rt_id,
    role = 'warga',
    full_name = CASE
      WHEN v_profile.full_name IN ('', 'Pengguna', 'Warga RT') THEN v_reg.full_name
      ELSE v_profile.full_name
    END,
    phone = v_phone
  WHERE id = v_user_id;

  UPDATE public.rt_warga_registry
  SET claimed_by = v_user_id, claimed_at = NOW()
  WHERE id = v_reg.id;

  UPDATE public.rt_units
  SET member_count = member_count + 1, updated_at = NOW()
  WHERE id = v_reg.rt_id;

  RETURN json_build_object(
    'joined', true,
    'rt_id', v_reg.rt_id,
    'role', 'warga'
  );
END;
$$;

-- ── Import batch (JSON array) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_warga_batch(p_rows JSONB)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ketua public.profiles%ROWTYPE;
  v_row JSONB;
  v_phone TEXT;
  v_name TEXT;
  v_ins INT := 0;
  v_upd INT := 0;
  v_skip INT := 0;
  v_exists BOOLEAN;
BEGIN
  SELECT * INTO v_ketua FROM public.profiles WHERE id = auth.uid();
  IF v_ketua.role != 'ketua_rt' OR v_ketua.rt_id IS NULL THEN
    RAISE EXCEPTION 'Hanya Ketua RT yang bisa import data warga';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_name := trim(COALESCE(v_row->>'full_name', ''));
    v_phone := public.normalize_phone_id(COALESCE(v_row->>'phone', ''));
    IF v_name = '' OR v_phone IN ('', '+62') THEN
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE rt_id = v_ketua.rt_id AND public.normalize_phone_id(phone) = v_phone
    ) THEN
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.rt_warga_registry
      WHERE rt_id = v_ketua.rt_id AND phone = v_phone
    ) INTO v_exists;

    INSERT INTO public.rt_warga_registry (rt_id, full_name, phone, email, blok_rumah, imported_by)
    VALUES (
      v_ketua.rt_id, v_name, v_phone,
      nullif(trim(COALESCE(v_row->>'email', '')), ''),
      nullif(trim(COALESCE(v_row->>'blok_rumah', '')), ''),
      v_ketua.id
    )
    ON CONFLICT (rt_id, phone) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      blok_rumah = EXCLUDED.blok_rumah,
      imported_by = EXCLUDED.imported_by;

    IF v_exists THEN v_upd := v_upd + 1; ELSE v_ins := v_ins + 1; END IF;
  END LOOP;

  RETURN json_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip);
END;
$$;

-- Update entri registry / profil warga oleh Ketua
CREATE OR REPLACE FUNCTION public.ketua_update_registry_entry(
  p_id UUID,
  p_full_name TEXT,
  p_phone TEXT,
  p_email TEXT DEFAULT NULL,
  p_blok_rumah TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ketua public.profiles%ROWTYPE;
  v_phone TEXT;
BEGIN
  SELECT * INTO v_ketua FROM public.profiles WHERE id = auth.uid();
  IF v_ketua.role != 'ketua_rt' THEN RAISE EXCEPTION 'Hanya Ketua RT'; END IF;

  v_phone := public.normalize_phone_id(p_phone);
  IF v_phone IN ('', '+62') THEN RAISE EXCEPTION 'Nomor HP tidak valid'; END IF;

  UPDATE public.rt_warga_registry
  SET full_name = trim(p_full_name), phone = v_phone,
      email = nullif(trim(p_email), ''), blok_rumah = nullif(trim(p_blok_rumah), '')
  WHERE id = p_id AND rt_id = v_ketua.rt_id AND claimed_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ketua_update_member_name(p_member_id UUID, p_full_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ketua public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_ketua FROM public.profiles WHERE id = auth.uid();
  IF v_ketua.role != 'ketua_rt' THEN RAISE EXCEPTION 'Hanya Ketua RT'; END IF;

  UPDATE public.profiles
  SET full_name = trim(p_full_name)
  WHERE id = p_member_id AND rt_id = v_ketua.rt_id AND id != v_ketua.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ketua_delete_registry_entry(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ketua public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_ketua FROM public.profiles WHERE id = auth.uid();
  IF v_ketua.role != 'ketua_rt' THEN RAISE EXCEPTION 'Hanya Ketua RT'; END IF;

  DELETE FROM public.rt_warga_registry
  WHERE id = p_id AND rt_id = v_ketua.rt_id AND claimed_at IS NULL;
END;
$$;

-- Perkuat ensure_my_profile: coba auto-join
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user RECORD;
  v_profile RECORD;
  v_join JSON;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND THEN
    SELECT * INTO v_user FROM auth.users WHERE id = v_user_id;
    INSERT INTO public.profiles (id, full_name, phone, role, is_active)
    VALUES (
      v_user_id,
      COALESCE(v_user.raw_user_meta_data->>'full_name', 'Pengguna'),
      public.normalize_phone_id(COALESCE(v_user.raw_user_meta_data->>'phone', '')),
      'warga', TRUE
    );
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  END IF;

  IF v_profile.rt_id IS NULL AND COALESCE(v_profile.phone, '') NOT IN ('', '+62') THEN
    PERFORM public.try_auto_join_rt();
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  END IF;

  RETURN row_to_json(v_profile)::json;
END;
$$;

GRANT EXECUTE ON FUNCTION public.try_auto_join_rt TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_warga_batch TO authenticated;
GRANT EXECUTE ON FUNCTION public.ketua_update_registry_entry TO authenticated;
GRANT EXECUTE ON FUNCTION public.ketua_update_member_name TO authenticated;
GRANT EXECUTE ON FUNCTION public.ketua_delete_registry_entry TO authenticated;


-- ==================== 008_multi_rt_memberships.sql ====================

-- Multi-RT membership untuk warga (rumah di beberapa RT)
-- profiles.rt_id = RT yang sedang aktif di aplikasi

CREATE TABLE IF NOT EXISTS public.rt_memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rt_id      UUID NOT NULL REFERENCES public.rt_units(id) ON DELETE CASCADE,
  role       public.user_role NOT NULL DEFAULT 'warga',
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, rt_id)
);

CREATE INDEX IF NOT EXISTS idx_rt_memberships_user ON public.rt_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_rt_memberships_rt ON public.rt_memberships(rt_id);

ALTER TABLE public.rt_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "memberships_select_own" ON public.rt_memberships;
CREATE POLICY "memberships_select_own" ON public.rt_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Backfill dari profiles yang sudah punya RT
INSERT INTO public.rt_memberships (user_id, rt_id, role)
SELECT p.id, p.rt_id, p.role::public.user_role
FROM public.profiles p
WHERE p.rt_id IS NOT NULL
ON CONFLICT (user_id, rt_id) DO NOTHING;

-- ── Gabung RT (pertama atau RT tambahan untuk warga) ───────────
CREATE OR REPLACE FUNCTION public.join_rt_by_code(p_invite_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_rt RECORD;
  v_is_new BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  IF v_profile.role IN ('ketua_rt', 'bendahara') AND v_profile.rt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ketua/Bendahara tidak bisa gabung ke RT lain. Gunakan akun warga terpisah.';
  END IF;

  SELECT * INTO v_rt
  FROM public.rt_units
  WHERE UPPER(invite_code) = UPPER(TRIM(p_invite_code));

  IF v_rt IS NULL THEN
    RAISE EXCEPTION 'Kode undangan tidak valid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rt_memberships
    WHERE user_id = v_user_id AND rt_id = v_rt.id
  ) THEN
    PERFORM public.switch_active_rt(v_rt.id);
    RETURN json_build_object(
      'rt_id', v_rt.id,
      'rt_name', v_rt.name,
      'role', 'warga',
      'switched', true
    );
  END IF;

  v_is_new := TRUE;

  INSERT INTO public.rt_memberships (user_id, rt_id, role)
  VALUES (v_user_id, v_rt.id, 'warga');

  PERFORM set_config('ronda.allow_role_change', 'true', true);
  UPDATE public.profiles
  SET role = 'warga', rt_id = v_rt.id
  WHERE id = v_user_id;
  PERFORM set_config('ronda.allow_role_change', 'false', true);

  UPDATE public.rt_units
  SET member_count = member_count + 1, updated_at = NOW()
  WHERE id = v_rt.id;

  RETURN json_build_object(
    'rt_id', v_rt.id,
    'rt_name', v_rt.name,
    'role', 'warga',
    'switched', false,
    'additional', v_profile.rt_id IS NOT NULL
  );
END;
$$;

-- ── Ganti RT aktif ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.switch_active_rt(p_rt_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rt RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rt_memberships
    WHERE user_id = v_user_id AND rt_id = p_rt_id
  ) THEN
    RAISE EXCEPTION 'Anda bukan anggota RT ini';
  END IF;

  SELECT * INTO v_rt FROM public.rt_units WHERE id = p_rt_id;

  PERFORM set_config('ronda.allow_role_change', 'true', true);
  UPDATE public.profiles SET rt_id = p_rt_id WHERE id = v_user_id;
  PERFORM set_config('ronda.allow_role_change', 'false', true);

  RETURN json_build_object('rt_id', v_rt.id, 'rt_name', v_rt.name);
END;
$$;

-- ── Daftar keanggotaan RT saya ───────────────────────────────
CREATE OR REPLACE FUNCTION public.list_my_rt_memberships()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_active UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT rt_id INTO v_active FROM public.profiles WHERE id = v_user_id;

  RETURN COALESCE((
    SELECT json_agg(row_to_json(t) ORDER BY t.is_active DESC, t.joined_at)
    FROM (
      SELECT
        m.rt_id,
        u.name AS rt_name,
        u.rt_number,
        u.rw_number,
        u.address,
        m.role::TEXT AS role,
        m.joined_at,
        (m.rt_id = v_active) AS is_active
      FROM public.rt_memberships m
      JOIN public.rt_units u ON u.id = m.rt_id
      WHERE m.user_id = v_user_id
    ) t
  ), '[]'::JSON);
END;
$$;

-- ── Ringkasan iuran RT (untuk kartu warga) ───────────────────
CREATE OR REPLACE FUNCTION public.get_iuran_rt_summary(p_rt_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT := to_char(NOW(), 'YYYY-MM');
  v_total INT;
  v_paid INT;
BEGIN
  SELECT COUNT(*)::INT INTO v_total
  FROM public.profiles
  WHERE rt_id = p_rt_id AND role = 'warga';

  SELECT COUNT(*)::INT INTO v_paid
  FROM public.iuran_records
  WHERE rt_id = p_rt_id
    AND period_key = v_period
    AND status = 'paid';

  RETURN json_build_object(
    'period_key', v_period,
    'total_warga', v_total,
    'paid_count', v_paid,
    'unpaid_count', GREATEST(v_total - v_paid, 0)
  );
END;
$$;

-- Perbarui auto-join agar isi memberships
CREATE OR REPLACE FUNCTION public.try_auto_join_rt()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_reg public.rt_warga_registry%ROWTYPE;
  v_phone TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  v_phone := public.normalize_phone_id(COALESCE(v_profile.phone, ''));
  IF v_phone = '' OR v_phone = '+62' THEN
    RETURN json_build_object('joined', false, 'reason', 'no_phone');
  END IF;

  SELECT * INTO v_reg
  FROM public.rt_warga_registry
  WHERE phone = v_phone AND claimed_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_reg IS NULL THEN
    RETURN json_build_object('joined', false, 'reason', 'not_in_registry');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rt_memberships
    WHERE user_id = v_user_id AND rt_id = v_reg.rt_id
  ) THEN
    UPDATE public.profiles SET rt_id = v_reg.rt_id, role = 'warga' WHERE id = v_user_id;
    RETURN json_build_object('joined', false, 'reason', 'already_member', 'rt_id', v_reg.rt_id);
  END IF;

  UPDATE public.profiles
  SET
    rt_id = v_reg.rt_id,
    role = 'warga',
    full_name = CASE
      WHEN v_profile.full_name IN ('', 'Pengguna', 'Warga RT') THEN v_reg.full_name
      ELSE v_profile.full_name
    END,
    phone = v_phone
  WHERE id = v_user_id;

  INSERT INTO public.rt_memberships (user_id, rt_id, role)
  VALUES (v_user_id, v_reg.rt_id, 'warga')
  ON CONFLICT (user_id, rt_id) DO NOTHING;

  UPDATE public.rt_warga_registry
  SET claimed_by = v_user_id, claimed_at = NOW()
  WHERE id = v_reg.id;

  UPDATE public.rt_units
  SET member_count = member_count + 1, updated_at = NOW()
  WHERE id = v_reg.rt_id;

  RETURN json_build_object(
    'joined', true,
    'rt_id', v_reg.rt_id,
    'role', 'warga'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.switch_active_rt TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_rt_memberships TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_iuran_rt_summary TO authenticated;


-- ==================== 009_approve_iuran_officer.sql ====================

-- Ketua / Bendahara dapat menyetujui pembayaran iuran warga (verifikasi tunai/transfer)
CREATE OR REPLACE FUNCTION public.approve_iuran_as_officer(p_iuran_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer UUID := auth.uid();
  v_officer_rec public.profiles%ROWTYPE;
  v_row public.iuran_records%ROWTYPE;
  v_warga_name TEXT;
BEGIN
  IF v_officer IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_officer_rec FROM public.profiles WHERE id = v_officer;
  IF v_officer_rec.role NOT IN ('ketua_rt', 'bendahara') THEN
    RAISE EXCEPTION 'Hanya Ketua RT atau Bendahara yang bisa verifikasi iuran';
  END IF;

  SELECT * INTO v_row FROM public.iuran_records WHERE id = p_iuran_id FOR UPDATE;
  IF v_row IS NULL OR v_row.rt_id != v_officer_rec.rt_id THEN
    RAISE EXCEPTION 'Tagihan tidak ditemukan di RT Anda';
  END IF;

  IF v_row.status = 'paid' THEN
    RAISE EXCEPTION 'Tagihan sudah lunas';
  END IF;

  SELECT full_name INTO v_warga_name FROM public.profiles WHERE id = v_row.user_id;

  UPDATE public.iuran_records
  SET status = 'paid', paid_at = NOW()
  WHERE id = p_iuran_id;

  INSERT INTO public.kas_transactions (rt_id, recorded_by, type, amount, description, category)
  VALUES (
    v_row.rt_id, v_officer, 'masuk', v_row.amount,
    'Iuran ' || v_row.period_label || ' — ' || COALESCE(v_warga_name, 'Warga') || ' (verifikasi RT)',
    'iuran'
  );

  RETURN json_build_object('status', 'paid', 'iuran_id', p_iuran_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_iuran_as_officer TO authenticated;


-- ==================== 010_profile_avatar.sql ====================

-- Foto profil warga / pengurus
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-avatars',
  'profile-avatars',
  true,
  3145728,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "profile_avatars_public_read" ON storage.objects;
DROP POLICY IF EXISTS "profile_avatars_own_insert" ON storage.objects;
DROP POLICY IF EXISTS "profile_avatars_own_update" ON storage.objects;
DROP POLICY IF EXISTS "profile_avatars_own_delete" ON storage.objects;

CREATE POLICY "profile_avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'profile-avatars');

CREATE POLICY "profile_avatars_own_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'profile-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "profile_avatars_own_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'profile-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "profile_avatars_own_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'profile-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );


-- ==================== 011_fix_switch_active_rt.sql ====================

-- Fix: ganti RT aktif gagal — "Role dan RT hanya bisa diubah melalui fungsi resmi"
-- Penyebab: switch_active_rt UPDATE profiles tanpa set_config ronda.allow_role_change

CREATE OR REPLACE FUNCTION public.switch_active_rt(p_rt_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rt RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rt_memberships
    WHERE user_id = v_user_id AND rt_id = p_rt_id
  ) THEN
    RAISE EXCEPTION 'Anda bukan anggota RT ini';
  END IF;

  SELECT * INTO v_rt FROM public.rt_units WHERE id = p_rt_id;

  PERFORM set_config('ronda.allow_role_change', 'true', true);
  UPDATE public.profiles SET rt_id = p_rt_id WHERE id = v_user_id;
  PERFORM set_config('ronda.allow_role_change', 'false', true);

  RETURN json_build_object('rt_id', v_rt.id, 'rt_name', v_rt.name);
END;
$$;

-- Auto-join: beberapa UPDATE rt_id juga perlu bypass
CREATE OR REPLACE FUNCTION public.try_auto_join_rt()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_reg public.rt_warga_registry%ROWTYPE;
  v_phone TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  v_phone := public.normalize_phone_id(COALESCE(v_profile.phone, ''));
  IF v_phone = '' OR v_phone = '+62' THEN
    RETURN json_build_object('joined', false, 'reason', 'no_phone');
  END IF;

  SELECT * INTO v_reg
  FROM public.rt_warga_registry
  WHERE phone = v_phone AND claimed_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_reg IS NULL THEN
    RETURN json_build_object('joined', false, 'reason', 'not_in_registry');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rt_memberships
    WHERE user_id = v_user_id AND rt_id = v_reg.rt_id
  ) THEN
    PERFORM set_config('ronda.allow_role_change', 'true', true);
    UPDATE public.profiles SET rt_id = v_reg.rt_id, role = 'warga' WHERE id = v_user_id;
    PERFORM set_config('ronda.allow_role_change', 'false', true);
    RETURN json_build_object('joined', false, 'reason', 'already_member', 'rt_id', v_reg.rt_id);
  END IF;

  PERFORM set_config('ronda.allow_role_change', 'true', true);
  UPDATE public.profiles
  SET
    rt_id = v_reg.rt_id,
    role = 'warga',
    full_name = CASE
      WHEN v_profile.full_name IN ('', 'Pengguna', 'Warga RT') THEN v_reg.full_name
      ELSE v_profile.full_name
    END,
    phone = v_phone
  WHERE id = v_user_id;
  PERFORM set_config('ronda.allow_role_change', 'false', true);

  INSERT INTO public.rt_memberships (user_id, rt_id, role)
  VALUES (v_user_id, v_reg.rt_id, 'warga')
  ON CONFLICT (user_id, rt_id) DO NOTHING;

  UPDATE public.rt_warga_registry
  SET claimed_by = v_user_id, claimed_at = NOW()
  WHERE id = v_reg.id;

  UPDATE public.rt_units
  SET member_count = member_count + 1, updated_at = NOW()
  WHERE id = v_reg.rt_id;

  RETURN json_build_object(
    'joined', true,
    'rt_id', v_reg.rt_id,
    'role', 'warga'
  );
END;
$$;


-- ==================== 012_iuran_awaiting_verification.sql ====================

-- Status menunggu verifikasi setelah warga upload bukti bayar
ALTER TABLE public.iuran_records DROP CONSTRAINT IF EXISTS iuran_records_status_check;
ALTER TABLE public.iuran_records
  ADD CONSTRAINT iuran_records_status_check
  CHECK (status IN ('pending', 'awaiting_verification', 'paid'));

ALTER TABLE public.iuran_records
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

-- Warga ajukan pembayaran → menunggu verifikasi Bendahara/Ketua
CREATE OR REPLACE FUNCTION public.submit_iuran_payment(
  p_iuran_id UUID,
  p_payment_method TEXT DEFAULT 'qris',
  p_payment_proof_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row public.iuran_records%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_row FROM public.iuran_records WHERE id = p_iuran_id FOR UPDATE;
  IF v_row IS NULL OR v_row.user_id != v_user THEN
    RAISE EXCEPTION 'Tagihan tidak ditemukan';
  END IF;
  IF v_row.status = 'paid' THEN
    RAISE EXCEPTION 'Tagihan sudah lunas';
  END IF;
  IF v_row.status = 'awaiting_verification' THEN
    RAISE EXCEPTION 'Bukti pembayaran sudah diajukan, menunggu verifikasi';
  END IF;

  UPDATE public.iuran_records
  SET
    status = 'awaiting_verification',
    payment_method = COALESCE(NULLIF(trim(p_payment_method), ''), 'qris'),
    payment_proof_url = p_payment_proof_url,
    submitted_at = NOW()
  WHERE id = p_iuran_id;

  RETURN json_build_object('status', 'awaiting_verification', 'iuran_id', p_iuran_id);
END;
$$;

-- Verifikasi officer: dari pending (tunai langsung) atau awaiting_verification
CREATE OR REPLACE FUNCTION public.approve_iuran_as_officer(p_iuran_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer UUID := auth.uid();
  v_officer_rec public.profiles%ROWTYPE;
  v_row public.iuran_records%ROWTYPE;
  v_warga_name TEXT;
BEGIN
  IF v_officer IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_officer_rec FROM public.profiles WHERE id = v_officer;
  IF v_officer_rec.role NOT IN ('ketua_rt', 'bendahara') THEN
    RAISE EXCEPTION 'Hanya Ketua RT atau Bendahara yang bisa verifikasi iuran';
  END IF;

  SELECT * INTO v_row FROM public.iuran_records WHERE id = p_iuran_id FOR UPDATE;
  IF v_row IS NULL OR v_row.rt_id != v_officer_rec.rt_id THEN
    RAISE EXCEPTION 'Tagihan tidak ditemukan di RT Anda';
  END IF;

  IF v_row.status = 'paid' THEN
    RAISE EXCEPTION 'Tagihan sudah lunas';
  END IF;

  IF v_row.status NOT IN ('pending', 'awaiting_verification') THEN
    RAISE EXCEPTION 'Status tagihan tidak valid untuk verifikasi';
  END IF;

  SELECT full_name INTO v_warga_name FROM public.profiles WHERE id = v_row.user_id;

  UPDATE public.iuran_records
  SET status = 'paid', paid_at = COALESCE(paid_at, NOW())
  WHERE id = p_iuran_id;

  INSERT INTO public.kas_transactions (rt_id, recorded_by, type, amount, description, category)
  VALUES (
    v_row.rt_id, v_officer, 'masuk', v_row.amount,
    'Iuran ' || v_row.period_label || ' — ' || COALESCE(v_warga_name, 'Warga') || ' (verifikasi RT)',
    'iuran'
  );

  RETURN json_build_object('status', 'paid', 'iuran_id', p_iuran_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_iuran_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_iuran_as_officer TO authenticated;


-- ==================== 013_iuran_payment_proof_storage.sql ====================

-- Bukti bayar iuran: warga upload, officer & warga bisa lihat (bucket publik)
-- Migration 012 hanya RPC/tabel — error 403 Storage RLS butuh file ini.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'iuran-payment-proofs',
  'iuran-payment-proofs',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "iuran_proofs_public_read" ON storage.objects;
DROP POLICY IF EXISTS "iuran_proofs_warga_insert" ON storage.objects;
DROP POLICY IF EXISTS "iuran_proofs_warga_update" ON storage.objects;
DROP POLICY IF EXISTS "iuran_proofs_warga_delete" ON storage.objects;

CREATE POLICY "iuran_proofs_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'iuran-payment-proofs');

-- Path: {user_id}/{rt_id}/{timestamp}.ext — sama pola dengan profile-avatars
CREATE POLICY "iuran_proofs_warga_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'iuran-payment-proofs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "iuran_proofs_warga_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'iuran-payment-proofs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "iuran_proofs_warga_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'iuran-payment-proofs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );


-- ==================== 014_rt_settings.sql ====================

-- ============================================================
-- Setting RT (Ketua RT): kop surat, tanda tangan, QRIS, norek bank
-- Alamat memakai kolom rt_units.address yang sudah ada.
-- Jalankan di Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.rt_units
  ADD COLUMN IF NOT EXISTS kop_surat_url       TEXT,
  ADD COLUMN IF NOT EXISTS signature_url       TEXT,
  ADD COLUMN IF NOT EXISTS qris_url            TEXT,
  ADD COLUMN IF NOT EXISTS bank_name           TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name   TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT;

-- Ketua sudah bisa UPDATE rt_units miliknya lewat policy "rt_update_ketua"
-- (dibuat di migrasi 001), jadi tidak perlu RPC baru untuk simpan setting.

-- ── Storage bucket: aset RT (kop surat, tanda tangan, QRIS) ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rt-assets',
  'rt-assets',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "rt_assets_public_read" ON storage.objects;
DROP POLICY IF EXISTS "rt_assets_ketua_insert" ON storage.objects;
DROP POLICY IF EXISTS "rt_assets_ketua_update" ON storage.objects;
DROP POLICY IF EXISTS "rt_assets_ketua_delete" ON storage.objects;

-- Publik boleh baca (QRIS ditampilkan ke warga; kop/tt dipakai di surat)
CREATE POLICY "rt_assets_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'rt-assets');

-- Hanya Ketua RT yang boleh unggah/ubah/hapus. Path diawali {rt_id}/...
CREATE POLICY "rt_assets_ketua_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rt-assets'
    AND auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'ketua_rt')
  );

CREATE POLICY "rt_assets_ketua_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'rt-assets'
    AND auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'ketua_rt')
  );

CREATE POLICY "rt_assets_ketua_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rt-assets'
    AND auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'ketua_rt')
  );


-- ==================== 015_surat_applicant_data.sql ====================

-- ============================================================
-- Data pemohon pada permohonan surat (diisi warga saat mengajukan):
-- NIK, tempat & tanggal lahir, pekerjaan. Dipakai di draft surat.
-- Jalankan di Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.surat_requests
  ADD COLUMN IF NOT EXISTS nik         TEXT,
  ADD COLUMN IF NOT EXISTS birth_place TEXT,
  ADD COLUMN IF NOT EXISTS birth_date  TEXT,
  ADD COLUMN IF NOT EXISTS occupation  TEXT;


-- ==================== 016_profile_personal_data.sql ====================

-- ============================================================
-- Data diri warga di profil (diisi sekali, dipakai auto-isi surat):
-- NIK, tempat & tanggal lahir, pekerjaan.
-- Jalankan di Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nik         TEXT,
  ADD COLUMN IF NOT EXISTS birth_place TEXT,
  ADD COLUMN IF NOT EXISTS birth_date  TEXT,
  ADD COLUMN IF NOT EXISTS occupation  TEXT;


-- ==================== 017_surat_full_format.sql ====================

-- ============================================================
-- Lengkapi format surat agar sesuai kop resmi:
-- - profiles: jenis kelamin, agama, status perkawinan
-- - rt_units: kelurahan, kecamatan, kota (untuk kop & pembuka)
-- - surat_requests: snapshot jenis kelamin/agama/status saat mengajukan
-- Jalankan di Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender         TEXT,
  ADD COLUMN IF NOT EXISTS religion       TEXT,
  ADD COLUMN IF NOT EXISTS marital_status TEXT;

ALTER TABLE public.rt_units
  ADD COLUMN IF NOT EXISTS kelurahan TEXT,
  ADD COLUMN IF NOT EXISTS kecamatan TEXT,
  ADD COLUMN IF NOT EXISTS kota      TEXT;

ALTER TABLE public.surat_requests
  ADD COLUMN IF NOT EXISTS gender         TEXT,
  ADD COLUMN IF NOT EXISTS religion       TEXT,
  ADD COLUMN IF NOT EXISTS marital_status TEXT;

-- ==================== 018_rt_iuran_amount.sql ====================

ALTER TABLE public.rt_units
  ADD COLUMN IF NOT EXISTS iuran_amount NUMERIC(15, 2) NOT NULL DEFAULT 50000;

CREATE OR REPLACE FUNCTION public.ensure_monthly_iuran(
  p_amount NUMERIC DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rt_id UUID;
  v_role TEXT;
  v_period_key TEXT := to_char(NOW(), 'YYYY-MM');
  v_period_label TEXT;
  v_amount NUMERIC;
  v_count INT;
BEGIN
  SELECT rt_id, role INTO v_rt_id, v_role
  FROM public.profiles WHERE id = auth.uid();

  IF v_rt_id IS NULL THEN
    RAISE EXCEPTION 'Anda belum tergabung RT';
  END IF;

  IF v_role NOT IN ('ketua_rt', 'bendahara') THEN
    RAISE EXCEPTION 'Hanya Ketua/Bendahara yang bisa generate tagihan';
  END IF;

  SELECT COALESCE(iuran_amount, p_amount, 50000) INTO v_amount
  FROM public.rt_units WHERE id = v_rt_id;

  v_period_label := trim(to_char(NOW(), 'TMMonth YYYY'));

  INSERT INTO public.iuran_records (rt_id, user_id, period_key, period_label, amount)
  SELECT v_rt_id, p.id, v_period_key, v_period_label, v_amount
  FROM public.profiles p
  WHERE p.rt_id = v_rt_id AND p.role = 'warga'
  ON CONFLICT (rt_id, user_id, period_key) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_my_iuran(
  p_amount NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rt_id UUID;
  v_period_key TEXT := to_char(NOW(), 'YYYY-MM');
  v_period_label TEXT := trim(to_char(NOW(), 'TMMonth YYYY'));
  v_amount NUMERIC;
  v_id UUID;
BEGIN
  SELECT rt_id INTO v_rt_id FROM public.profiles WHERE id = auth.uid();
  IF v_rt_id IS NULL THEN RAISE EXCEPTION 'Anda belum tergabung RT'; END IF;

  SELECT COALESCE(iuran_amount, p_amount, 50000) INTO v_amount
  FROM public.rt_units WHERE id = v_rt_id;

  INSERT INTO public.iuran_records (rt_id, user_id, period_key, period_label, amount)
  VALUES (v_rt_id, auth.uid(), v_period_key, v_period_label, v_amount)
  ON CONFLICT (rt_id, user_id, period_key) DO UPDATE
    SET period_label = EXCLUDED.period_label,
        amount = CASE WHEN public.iuran_records.status = 'unpaid'
                      THEN EXCLUDED.amount ELSE public.iuran_records.amount END
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_monthly_iuran TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_iuran TO authenticated;

-- ==================== 019_rt_iuran_components.sql ====================

ALTER TABLE public.rt_units
  ADD COLUMN IF NOT EXISTS iuran_components JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ==================== 020_family_members.sql ====================

CREATE TABLE IF NOT EXISTS public.family_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rt_id          UUID NOT NULL REFERENCES public.rt_units(id) ON DELETE CASCADE,
  head_user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  relation       TEXT,
  nik            TEXT,
  birth_place    TEXT,
  birth_date     TEXT,
  gender         TEXT,
  religion       TEXT,
  marital_status TEXT,
  occupation     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_family_head ON public.family_members(head_user_id);
CREATE INDEX IF NOT EXISTS idx_family_rt ON public.family_members(rt_id);

ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_select" ON public.family_members;
CREATE POLICY "family_select" ON public.family_members
  FOR SELECT USING (
    head_user_id = auth.uid()
    OR (
      rt_id = public.current_user_rt_id()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role IN ('ketua_rt', 'bendahara')
      )
    )
  );

DROP POLICY IF EXISTS "family_write_officer" ON public.family_members;
CREATE POLICY "family_write_officer" ON public.family_members
  FOR ALL USING (
    rt_id = public.current_user_rt_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('ketua_rt', 'bendahara')
    )
  ) WITH CHECK (
    rt_id = public.current_user_rt_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('ketua_rt', 'bendahara')
    )
  );

-- ===== 021_surat_applicant_name.sql =====
ALTER TABLE public.surat_requests
  ADD COLUMN IF NOT EXISTS applicant_name TEXT;
-- 022_profile_address.sql
-- Alamat rumah per-warga (dibaca dari Kartu Keluarga saat scan KK, bukan input manual).
-- Dipakai untuk: kolom Blok/Rumah ekspor Data Warga, alamat template Ucapan Duka Cita, dan surat.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address TEXT;

-- Ketua RT menyetel alamat seorang warga di RT-nya (mis. hasil scan KK).
CREATE OR REPLACE FUNCTION public.ketua_update_member_address(p_member_id UUID, p_address TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ketua public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_ketua FROM public.profiles WHERE id = auth.uid();
  IF v_ketua.role NOT IN ('ketua_rt', 'bendahara') THEN
    RAISE EXCEPTION 'Hanya Ketua/Bendahara RT';
  END IF;

  UPDATE public.profiles
  SET address = NULLIF(trim(p_address), '')
  WHERE id = p_member_id AND rt_id = v_ketua.rt_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ketua_update_member_address TO authenticated;
-- 023_warga_approval.sql
-- Persetujuan warga baru oleh Ketua RT (Model A: gerbang).
-- Warga daftar via kode undangan -> status 'pending' (belum bisa pakai app penuh).
-- Ketua approve -> 'approved' (aktif). Ketua tolak -> keluar RT ('rejected').

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';
-- Nilai: 'pending' | 'approved' | 'rejected'. Baris lama = 'approved' (grandfathered).

-- join_rt_by_code: warga baru masuk sebagai 'pending', member_count TIDAK bertambah
-- sampai di-approve.
CREATE OR REPLACE FUNCTION public.join_rt_by_code(p_invite_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_rt RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF v_profile.rt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Anda sudah tergabung dalam RT';
  END IF;

  SELECT * INTO v_rt FROM public.rt_units
  WHERE UPPER(invite_code) = UPPER(TRIM(p_invite_code));
  IF v_rt IS NULL THEN RAISE EXCEPTION 'Kode undangan tidak valid'; END IF;

  -- Bypass trigger protect_profile_role (warga ubah role/rt_id sendiri).
  PERFORM set_config('ronda.allow_role_change', 'true', true);
  UPDATE public.profiles
  SET role = 'warga', rt_id = v_rt.id, approval_status = 'pending'
  WHERE id = v_user_id;
  PERFORM set_config('ronda.allow_role_change', 'false', true);

  RETURN json_build_object(
    'rt_id', v_rt.id,
    'rt_name', v_rt.name,
    'role', 'warga',
    'approval_status', 'pending'
  );
END;
$$;

-- Ketua approve warga pending -> aktif + member_count++.
CREATE OR REPLACE FUNCTION public.ketua_approve_warga(p_warga_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ketua public.profiles%ROWTYPE;
  v_rows INT;
BEGIN
  SELECT * INTO v_ketua FROM public.profiles WHERE id = auth.uid();
  IF v_ketua.role NOT IN ('ketua_rt', 'bendahara') THEN
    RAISE EXCEPTION 'Hanya Ketua/Bendahara RT';
  END IF;

  UPDATE public.profiles
  SET approval_status = 'approved'
  WHERE id = p_warga_id AND rt_id = v_ketua.rt_id AND approval_status = 'pending';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    UPDATE public.rt_units SET member_count = member_count + 1, updated_at = NOW()
    WHERE id = v_ketua.rt_id;
  END IF;
END;
$$;

-- Ketua tolak warga pending -> keluarkan dari RT.
CREATE OR REPLACE FUNCTION public.ketua_reject_warga(p_warga_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ketua public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_ketua FROM public.profiles WHERE id = auth.uid();
  IF v_ketua.role NOT IN ('ketua_rt', 'bendahara') THEN
    RAISE EXCEPTION 'Hanya Ketua/Bendahara RT';
  END IF;

  UPDATE public.profiles
  SET rt_id = NULL, approval_status = 'rejected', role = 'warga'
  WHERE id = p_warga_id AND rt_id = v_ketua.rt_id AND approval_status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION public.ketua_approve_warga TO authenticated;
GRANT EXECUTE ON FUNCTION public.ketua_reject_warga TO authenticated;
-- 024_kk_document.sql
-- Dokumen Kartu Keluarga (PDF) yang diunggah warga saat daftar.
-- Dipakai auto-isi data + preview oleh Ketua RT saat menyetujui warga baru.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kk_url TEXT;

-- Bucket publik untuk PDF KK (path: {user_id}/kk.pdf).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kk-docs',
  'kk-docs',
  true,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "kk_docs_public_read" ON storage.objects;
DROP POLICY IF EXISTS "kk_docs_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "kk_docs_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "kk_docs_owner_delete" ON storage.objects;

CREATE POLICY "kk_docs_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'kk-docs');

CREATE POLICY "kk_docs_owner_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'kk-docs' AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "kk_docs_owner_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'kk-docs' AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "kk_docs_owner_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'kk-docs' AND auth.uid()::text = (storage.foldername(name))[1]
  );


-- ═══════════════════════════════════════════════════════════════
-- 025: regenerate_invite_code (Ketua ganti kode undangan)
-- ═══════════════════════════════════════════════════════════════
-- 025: Ketua RT bisa mengganti (regenerate) kode undangan RT bila bocor.
-- Memakai generate_invite_code() yang sudah ada (acak 6 char, unik per-RT).

CREATE OR REPLACE FUNCTION public.regenerate_invite_code(p_rt_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_ketua UUID;
BEGIN
  SELECT ketua_id INTO v_ketua FROM public.rt_units WHERE id = p_rt_id;
  IF v_ketua IS NULL THEN
    RAISE EXCEPTION 'RT tidak ditemukan';
  END IF;
  IF v_ketua <> auth.uid() THEN
    RAISE EXCEPTION 'Hanya Ketua RT yang bisa mengganti kode undangan';
  END IF;

  -- ulang sampai dapat kode yang belum dipakai RT lain
  LOOP
    v_code := public.generate_invite_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rt_units WHERE invite_code = v_code);
  END LOOP;

  UPDATE public.rt_units SET invite_code = v_code WHERE id = p_rt_id;
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_invite_code TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 026: kontak darurat RT
-- ═══════════════════════════════════════════════════════════════
-- 026: Kontak darurat RT (diisi Ketua RT) — Ketua/Bendahara/Security + telepon.
ALTER TABLE public.rt_units
  ADD COLUMN IF NOT EXISTS emergency_ketua_phone     TEXT,
  ADD COLUMN IF NOT EXISTS emergency_bendahara_phone TEXT,
  ADD COLUMN IF NOT EXISTS emergency_security_name   TEXT,
  ADD COLUMN IF NOT EXISTS emergency_security_phone  TEXT;


-- ═══════════════════════════════════════════════════════════════
-- 027: reject_iuran_as_officer (tolak bukti bayar iuran)
-- ═══════════════════════════════════════════════════════════════
-- 027: Ketua/Bendahara bisa MENOLAK bukti pembayaran iuran (kembalikan ke pending).
CREATE OR REPLACE FUNCTION public.reject_iuran_as_officer(p_iuran_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer UUID := auth.uid();
  v_officer_rec public.profiles%ROWTYPE;
  v_row public.iuran_records%ROWTYPE;
BEGIN
  IF v_officer IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_officer_rec FROM public.profiles WHERE id = v_officer;
  IF v_officer_rec.role NOT IN ('ketua_rt', 'bendahara') THEN
    RAISE EXCEPTION 'Hanya Ketua RT atau Bendahara yang bisa memverifikasi iuran';
  END IF;

  SELECT * INTO v_row FROM public.iuran_records WHERE id = p_iuran_id FOR UPDATE;
  IF v_row IS NULL OR v_row.rt_id != v_officer_rec.rt_id THEN
    RAISE EXCEPTION 'Tagihan tidak ditemukan di RT Anda';
  END IF;

  IF v_row.status <> 'awaiting_verification' THEN
    RAISE EXCEPTION 'Hanya pembayaran yang menunggu verifikasi yang bisa ditolak';
  END IF;

  -- Kembalikan ke belum bayar; hapus bukti agar warga bisa unggah ulang.
  UPDATE public.iuran_records
  SET status = 'pending', payment_proof_url = NULL, payment_method = NULL,
      paid_at = NULL, submitted_at = NULL
  WHERE id = p_iuran_id;

  RETURN json_build_object('status', 'pending', 'iuran_id', p_iuran_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_iuran_as_officer TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 028: edit/hapus pengumuman oleh pengurus
-- ═══════════════════════════════════════════════════════════════
-- 028: Ketua & Bendahara bisa EDIT dan HAPUS pengumuman di RT-nya.
-- Sebelumnya hanya ada INSERT (ketua/bendahara) & DELETE (ketua saja); UPDATE tak ada.

DROP POLICY IF EXISTS "announcements_delete_ketua" ON public.announcements;
DROP POLICY IF EXISTS "announcements_update_pengurus" ON public.announcements;
DROP POLICY IF EXISTS "announcements_delete_pengurus" ON public.announcements;

CREATE POLICY "announcements_update_pengurus" ON public.announcements
  FOR UPDATE USING (
    rt_id IN (SELECT rt_id FROM public.profiles WHERE id = auth.uid() AND role IN ('ketua_rt','bendahara'))
  ) WITH CHECK (
    rt_id IN (SELECT rt_id FROM public.profiles WHERE id = auth.uid() AND role IN ('ketua_rt','bendahara'))
  );

CREATE POLICY "announcements_delete_pengurus" ON public.announcements
  FOR DELETE USING (
    rt_id IN (SELECT rt_id FROM public.profiles WHERE id = auth.uid() AND role IN ('ketua_rt','bendahara'))
  );


-- ═══════════════════════════════════════════════════════════════
-- 029: setelan jadwal ronda
-- ═══════════════════════════════════════════════════════════════
-- 029: Setelan Jadwal Ronda (diatur Ketua). Rotasi tetap otomatis; ini hanya parameternya.
-- ronda_days: array angka hari (0=Minggu .. 6=Sabtu). NULL/kosong = tiap malam.
ALTER TABLE public.rt_units
  ADD COLUMN IF NOT EXISTS ronda_per_night INT  NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS ronda_start     TEXT NOT NULL DEFAULT '22.00',
  ADD COLUMN IF NOT EXISTS ronda_end       TEXT NOT NULL DEFAULT '04.00',
  ADD COLUMN IF NOT EXISTS ronda_days      INT[];


-- ═══════════════════════════════════════════════════════════════
-- 030: grup ronda manual (JSONB)
-- ═══════════════════════════════════════════════════════════════
-- 030: Grup ronda manual (dibuat Ketua). Disimpan sebagai JSONB di rt_units.
-- Format: [{ "name": "Grup 1", "color": "#059669", "memberIds": ["uuid", ...] }, ...]
-- Kosong/[] = pakai pembagian grup otomatis (dari ukuran grup di setelan).
ALTER TABLE public.rt_units
  ADD COLUMN IF NOT EXISTS ronda_groups JSONB NOT NULL DEFAULT '[]'::jsonb;
