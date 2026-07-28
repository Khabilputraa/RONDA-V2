// Port dari lib/services/rt_service.dart (lengkap)
import { supabase } from '../config/supabase';
import {
  Announcement,
  IuranRecord,
  KasSummary,
  KasTransaction,
  Profile,
  RtUnit,
  SuratApplicant,
  SuratRequest,
  announcementFromMap,
  emptyKasSummary,
  iuranRecordFromMap,
  kasSummaryFromMap,
  kasTransactionFromMap,
  profileFromMap,
  profileIsKetua,
  rtUnitFromMap,
  suratRequestFromMap,
} from '../types/models';
import { IuranRtSummary, iuranRtSummaryFromMap } from '../types/membership';

function dateOnly(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export const rtService = {
  async getMyRt(): Promise<RtUnit | null> {
    const userId = await currentUserId();
    if (userId == null) return null;

    const { data: profile } = await supabase
      .from('profiles')
      .select('rt_id')
      .eq('id', userId)
      .maybeSingle();
    const rtId = profile?.rt_id as string | undefined;
    if (rtId == null) return null;

    const { data } = await supabase.from('rt_units').select().eq('id', rtId).maybeSingle();
    if (data == null) return null;
    return rtUnitFromMap(data);
  },

  async getRtById(rtId: string): Promise<RtUnit | null> {
    const { data } = await supabase.from('rt_units').select().eq('id', rtId).maybeSingle();
    if (data == null) return null;
    return rtUnitFromMap(data);
  },

  // Simpan setting RT (Ketua). Kolom role/rt_id tidak disentuh; policy
  // "rt_update_ketua" (migrasi 001) mengizinkan Ketua meng-update RT-nya.
  async updateRtSettings(
    rtId: string,
    payload: {
      address?: string | null;
      kop_surat_url?: string | null;
      signature_url?: string | null;
      qris_url?: string | null;
      bank_name?: string | null;
      bank_account_name?: string | null;
      bank_account_number?: string | null;
      kelurahan?: string | null;
      kecamatan?: string | null;
      kota?: string | null;
      iuran_amount?: number;
      iuran_components?: { name: string; amount: number }[];
      emergency_ketua_phone?: string | null;
      emergency_bendahara_phone?: string | null;
      emergency_security_name?: string | null;
      emergency_security_phone?: string | null;
      ronda_per_night?: number;
      ronda_start?: string;
      ronda_end?: string;
      ronda_days?: number[] | null;
      ronda_groups?: { name: string; color: string; memberIds: string[] }[];
    },
  ): Promise<RtUnit> {
    const { data, error } = await supabase
      .from('rt_units')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', rtId)
      .select()
      .single();
    if (error) throw error;
    return rtUnitFromMap(data);
  },

  async createRt(args: {
    name: string;
    rtNumber: string;
    rwNumber?: string | null;
    address?: string | null;
  }): Promise<Record<string, any>> {
    const { data, error } = await supabase.rpc('create_rt_unit', {
      p_name: args.name,
      p_rt_number: args.rtNumber,
      p_rw_number: args.rwNumber ?? null,
      p_address: args.address ?? null,
    });
    if (error) throw error;
    return (data ?? {}) as Record<string, any>;
  },

  async regenerateInviteCode(rtId: string): Promise<string> {
    const { data, error } = await supabase.rpc('regenerate_invite_code', { p_rt_id: rtId });
    if (error) throw error;
    return String(data ?? '');
  },

  async joinRt(inviteCode: string): Promise<Record<string, any>> {
    const { data, error } = await supabase.rpc('join_rt_by_code', {
      p_invite_code: inviteCode.trim(),
    });
    if (error) throw error;
    return (data ?? {}) as Record<string, any>;
  },

  async getIuranRtSummary(rtId: string): Promise<IuranRtSummary | null> {
    try {
      const { data, error } = await supabase.rpc('get_iuran_rt_summary', { p_rt_id: rtId });
      if (error) throw error;
      if (data == null) return null;
      return iuranRtSummaryFromMap(data as any);
    } catch {
      return null;
    }
  },

  /** Ketua RT + Bendahara untuk halaman kontak warga. */
  async getRtPengurus(rtId: string): Promise<Profile[]> {
    try {
      const { data } = await supabase
        .from('profiles')
        .select()
        .eq('rt_id', rtId)
        .in('role', ['ketua_rt', 'bendahara'])
        .order('full_name');
      const list = (data ?? []).map(profileFromMap);
      list.sort((a, b) => {
        if (profileIsKetua(a) && !profileIsKetua(b)) return -1;
        if (profileIsKetua(b) && !profileIsKetua(a)) return 1;
        return a.fullName.localeCompare(b.fullName);
      });
      return list;
    } catch {
      return [];
    }
  },

  async getKetuaProfile(rtId: string): Promise<Profile | null> {
    try {
      const { data: rt } = await supabase
        .from('rt_units')
        .select('ketua_id')
        .eq('id', rtId)
        .maybeSingle();
      const ketuaId = rt?.ketua_id as string | undefined;
      if (ketuaId == null) return null;
      const { data } = await supabase.from('profiles').select().eq('id', ketuaId).maybeSingle();
      if (data == null) return null;
      return profileFromMap(data);
    } catch {
      return null;
    }
  },

  async countRecentAnnouncements(rtId: string, days = 14): Promise<number> {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    try {
      const { data } = await supabase
        .from('announcements')
        .select('id')
        .eq('rt_id', rtId)
        .gte('created_at', since);
      return (data ?? []).length;
    } catch {
      return 0;
    }
  },

  async countActiveSurat(rtId: string, userId: string): Promise<number> {
    try {
      const { data } = await supabase
        .from('surat_requests')
        .select('id')
        .eq('rt_id', rtId)
        .eq('user_id', userId)
        .in('status', ['pending', 'approved']);
      return (data ?? []).length;
    } catch {
      return 0;
    }
  },

  async appointBendahara(wargaId: string): Promise<void> {
    const { error } = await supabase.rpc('appoint_bendahara', { p_warga_id: wargaId });
    if (error) throw error;
  },

  async revokeBendahara(bendaharaId: string): Promise<void> {
    const { error } = await supabase.rpc('revoke_bendahara', { p_bendahara_id: bendaharaId });
    if (error) throw error;
  },

  // ── Persetujuan warga baru (Ketua) ───────────────────────────────
  async approveWarga(wargaId: string): Promise<void> {
    const { error } = await supabase.rpc('ketua_approve_warga', { p_warga_id: wargaId });
    if (error) throw error;
  },

  async rejectWarga(wargaId: string): Promise<void> {
    const { error } = await supabase.rpc('ketua_reject_warga', { p_warga_id: wargaId });
    if (error) throw error;
  },

  /** Jumlah warga menunggu persetujuan di RT (untuk lonceng Ketua). */
  async countPendingWarga(rtId: string): Promise<number> {
    const { count, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('rt_id', rtId)
      .eq('approval_status', 'pending');
    if (error) return 0;
    return count ?? 0;
  },

  async getRtMembers(): Promise<Profile[]> {
    const userId = await currentUserId();
    if (userId == null) return [];
    const { data: myProfile } = await supabase
      .from('profiles')
      .select('rt_id')
      .eq('id', userId)
      .maybeSingle();
    const rtId = myProfile?.rt_id as string | undefined;
    if (rtId == null) return [];
    const { data } = await supabase
      .from('profiles')
      .select()
      .eq('rt_id', rtId)
      .order('role')
      .order('full_name');
    return (data ?? []).map(profileFromMap);
  },

  // ── Kas ──────────────────────────────────────────────────────────
  async getKasSummary(rtId: string): Promise<KasSummary> {
    try {
      const { data } = await supabase
        .from('rt_kas_summary')
        .select()
        .eq('rt_id', rtId)
        .maybeSingle();
      if (data == null) return emptyKasSummary();
      return kasSummaryFromMap(data);
    } catch {
      return emptyKasSummary();
    }
  },

  async getKasTransactions(rtId: string, limit = 50): Promise<KasTransaction[]> {
    try {
      const { data } = await supabase
        .from('kas_transactions')
        .select('*, profiles(full_name)')
        .eq('rt_id', rtId)
        .order('created_at', { ascending: false })
        .limit(limit);
      return (data ?? []).map(kasTransactionFromMap);
    } catch {
      return [];
    }
  },

  async addKasTransaction(args: {
    rtId: string;
    type: string;
    amount: number;
    description: string;
    category?: string | null;
  }): Promise<void> {
    const userId = await currentUserId();
    const { error } = await supabase.from('kas_transactions').insert({
      rt_id: args.rtId,
      recorded_by: userId,
      type: args.type,
      amount: args.amount,
      description: args.description,
      category: args.category ?? null,
    });
    if (error) throw error;
  },

  // ── Pengumuman ───────────────────────────────────────────────────
  async getAnnouncements(rtId: string): Promise<Announcement[]> {
    const { data, error } = await supabase
      .from('announcements')
      .select('*, profiles(full_name)')
      .eq('rt_id', rtId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []).map(announcementFromMap);
  },

  async createAnnouncement(args: {
    rtId: string;
    title: string;
    content: string;
    isPinned?: boolean;
    eventDate?: Date | null;
    imageUrl?: string | null;
  }): Promise<Announcement> {
    const userId = await currentUserId();
    const row: Record<string, any> = {
      rt_id: args.rtId,
      author_id: userId,
      title: args.title,
      content: args.content,
      is_pinned: args.isPinned ?? false,
    };
    if (args.eventDate != null) row.event_date = dateOnly(args.eventDate);
    if (args.imageUrl && args.imageUrl.length > 0) row.image_url = args.imageUrl;

    const { data, error } = await supabase
      .from('announcements')
      .insert(row)
      .select('*, profiles(full_name)')
      .single();
    if (error) throw error;
    return announcementFromMap(data);
  },

  async updateAnnouncement(
    id: string,
    args: { title: string; content: string; isPinned?: boolean; eventDate?: Date | null },
  ): Promise<Announcement> {
    const row: Record<string, any> = {
      title: args.title,
      content: args.content,
      is_pinned: args.isPinned ?? false,
    };
    row.event_date = args.eventDate != null ? dateOnly(args.eventDate) : null;
    const { data, error } = await supabase
      .from('announcements')
      .update(row)
      .eq('id', id)
      .select('*, profiles(full_name)')
      .single();
    if (error) throw error;
    return announcementFromMap(data);
  },

  async deleteAnnouncement(id: string): Promise<void> {
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Iuran ────────────────────────────────────────────────────────
  async ensureMyIuran(amount = 50000): Promise<void> {
    const { error } = await supabase.rpc('ensure_my_iuran', { p_amount: amount });
    if (error) throw error;
  },

  async ensureMonthlyIuran(amount = 50000): Promise<number> {
    const { data, error } = await supabase.rpc('ensure_monthly_iuran', { p_amount: amount });
    if (error) throw error;
    return Number(data ?? 0);
  },

  async getIuranRecords(rtId: string, forUserId?: string): Promise<IuranRecord[]> {
    try {
      let query = supabase
        .from('iuran_records')
        .select('*, profiles(full_name)')
        .eq('rt_id', rtId);
      if (forUserId != null) query = query.eq('user_id', forUserId);
      const { data } = await query.order('period_key', { ascending: false }).limit(24);
      return (data ?? []).map(iuranRecordFromMap);
    } catch {
      return [];
    }
  },

  async payIuran(iuranId: string): Promise<void> {
    const { error } = await supabase.rpc('pay_iuran', { p_iuran_id: iuranId });
    if (error) throw error;
  },

  async submitIuranPayment(
    iuranId: string,
    paymentMethod: string,
    paymentProofUrl?: string | null,
  ): Promise<void> {
    const { error } = await supabase.rpc('submit_iuran_payment', {
      p_iuran_id: iuranId,
      p_payment_method: paymentMethod,
      p_payment_proof_url: paymentProofUrl ?? null,
    });
    if (error) throw error;
  },

  async approveIuranAsOfficer(iuranId: string): Promise<void> {
    const { error } = await supabase.rpc('approve_iuran_as_officer', { p_iuran_id: iuranId });
    if (error) throw error;
  },

  async rejectIuranAsOfficer(iuranId: string): Promise<void> {
    const { error } = await supabase.rpc('reject_iuran_as_officer', { p_iuran_id: iuranId });
    if (error) throw error;
  },

  // ── Surat ────────────────────────────────────────────────────────
  async getSuratRequests(rtId: string, allRt = false): Promise<SuratRequest[]> {
    try {
      const userId = await currentUserId();
      let query = supabase
        .from('surat_requests')
        .select('*, profiles(full_name, nik, occupation, marital_status, address)')
        .eq('rt_id', rtId);
      if (!allRt && userId != null) query = query.eq('user_id', userId);
      const { data } = await query.order('created_at', { ascending: false }).limit(30);
      return (data ?? []).map(suratRequestFromMap);
    } catch {
      return [];
    }
  },

  async submitSuratRequest(
    rtId: string,
    suratType: string,
    purpose: string,
    applicant?: SuratApplicant,
  ): Promise<void> {
    const userId = await currentUserId();
    const clean = (s?: string) => (s && s.trim() !== '' ? s.trim() : null);
    const { error } = await supabase.from('surat_requests').insert({
      rt_id: rtId,
      user_id: userId,
      surat_type: suratType,
      purpose,
      applicant_name: clean(applicant?.name),
      nik: clean(applicant?.nik),
      birth_place: clean(applicant?.birthPlace),
      birth_date: clean(applicant?.birthDate),
      occupation: clean(applicant?.occupation),
      gender: clean(applicant?.gender),
      religion: clean(applicant?.religion),
      marital_status: clean(applicant?.maritalStatus),
    });
    if (error) throw error;
  },

  async updateSuratStatus(suratId: string, status: string): Promise<void> {
    const { error } = await supabase
      .from('surat_requests')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', suratId);
    if (error) throw error;
  },
};
