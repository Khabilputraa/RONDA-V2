-- 029: Setelan Jadwal Ronda (diatur Ketua). Rotasi tetap otomatis; ini hanya parameternya.
-- ronda_days: array angka hari (0=Minggu .. 6=Sabtu). NULL/kosong = tiap malam.
ALTER TABLE public.rt_units
  ADD COLUMN IF NOT EXISTS ronda_per_night INT  NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS ronda_start     TEXT NOT NULL DEFAULT '22.00',
  ADD COLUMN IF NOT EXISTS ronda_end       TEXT NOT NULL DEFAULT '04.00',
  ADD COLUMN IF NOT EXISTS ronda_days      INT[];
