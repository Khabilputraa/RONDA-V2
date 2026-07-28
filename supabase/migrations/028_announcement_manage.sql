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
