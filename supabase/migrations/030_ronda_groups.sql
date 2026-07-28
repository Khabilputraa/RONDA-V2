-- 030: Grup ronda manual (dibuat Ketua). Disimpan sebagai JSONB di rt_units.
-- Format: [{ "name": "Grup 1", "color": "#059669", "memberIds": ["uuid", ...] }, ...]
-- Kosong/[] = pakai pembagian grup otomatis (dari ukuran grup di setelan).
ALTER TABLE public.rt_units
  ADD COLUMN IF NOT EXISTS ronda_groups JSONB NOT NULL DEFAULT '[]'::jsonb;
