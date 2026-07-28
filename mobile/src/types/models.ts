// Port dari lib/models/*.dart — tipe + fungsi mapping dari row Supabase.
import { formatDate, formatDateShort } from '../lib/date';
import { roleFromString, roleLabel, UserRole } from '../config/theme';

type Row = Record<string, any>;

function toDouble(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

// ── Profile ───────────────────────────────────────────────────────
export interface Profile {
  id: string;
  fullName: string;
  phone: string;
  role: string;
  rtId: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  // Data diri (diisi sekali, dipakai auto-isi surat) — lihat migrasi 016 & 017
  nik: string | null;
  birthPlace: string | null;
  birthDate: string | null;
  occupation: string | null;
  gender: string | null;
  religion: string | null;
  maritalStatus: string | null;
  address: string | null; // alamat rumah warga (dari KK) — migrasi 022
  approvalStatus: string; // 'pending' | 'approved' | 'rejected' — migrasi 023
  kkUrl: string | null; // URL PDF Kartu Keluarga — migrasi 024
}

export function profileFromMap(map: Row): Profile {
  const createdRaw = map.created_at;
  return {
    id: map.id as string,
    fullName: (map.full_name as string) ?? 'Pengguna',
    phone: (map.phone as string) ?? '',
    role: (map.role as string) ?? 'warga',
    rtId: (map.rt_id ?? map.area_id ?? null) as string | null,
    avatarUrl: (map.avatar_url as string) ?? null,
    isActive: (map.is_active as boolean) ?? true,
    createdAt: createdRaw ? new Date(createdRaw) : new Date(),
    nik: (map.nik as string) ?? null,
    birthPlace: (map.birth_place as string) ?? null,
    birthDate: (map.birth_date as string) ?? null,
    occupation: (map.occupation as string) ?? null,
    gender: (map.gender as string) ?? null,
    religion: (map.religion as string) ?? null,
    maritalStatus: (map.marital_status as string) ?? null,
    address: (map.address as string) ?? null,
    approvalStatus: (map.approval_status as string) ?? 'approved',
    kkUrl: (map.kk_url as string) ?? null,
  };
}

export const profileRole = (p: Profile): UserRole => roleFromString(p.role);
export const profileIsPending = (p: Profile): boolean => p.approvalStatus === 'pending';
export const profileHasRt = (p: Profile): boolean => p.rtId != null;
export const profileIsWarga = (p: Profile): boolean => profileRole(p) === 'warga';
export const profileIsKetua = (p: Profile): boolean => profileRole(p) === 'ketuaRt';
export const profileIsBendahara = (p: Profile): boolean => profileRole(p) === 'bendahara';
export const profileRoleLabel = (p: Profile): string => roleLabel(profileRole(p));

// ── RT Unit ───────────────────────────────────────────────────────
export interface IuranComponent {
  name: string;
  amount: number;
}

export interface RtUnit {
  id: string;
  name: string;
  rtNumber: string;
  rwNumber: string | null;
  address: string | null;
  inviteCode: string;
  ketuaId: string;
  memberCount: number;
  createdAt: Date;
  // Setting RT (diisi Ketua RT) — lihat migrasi 014_rt_settings.sql
  kopSuratUrl: string | null;
  signatureUrl: string | null;
  qrisUrl: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  iuranAmount: number;
  iuranComponents: IuranComponent[];
  // Kontak darurat (diisi Ketua RT) — migrasi 026
  emergencyKetuaPhone: string | null;
  emergencyBendaharaPhone: string | null;
  emergencySecurityName: string | null;
  emergencySecurityPhone: string | null;
  // Setelan jadwal ronda (diatur Ketua) — migrasi 029
  rondaPerNight: number;
  rondaStart: string;
  rondaEnd: string;
  rondaDays: number[]; // 0=Minggu..6=Sabtu; kosong = tiap malam
  // Grup ronda manual (migrasi 030); kosong = auto-bagi
  rondaGroups: { name: string; color: string; memberIds: string[] }[];
}

export function rtUnitFromMap(map: Row): RtUnit {
  return {
    id: map.id as string,
    name: map.name as string,
    rtNumber: map.rt_number as string,
    rwNumber: (map.rw_number as string) ?? null,
    address: (map.address as string) ?? null,
    inviteCode: map.invite_code as string,
    ketuaId: map.ketua_id as string,
    memberCount: (map.member_count as number) ?? 1,
    createdAt: new Date(map.created_at),
    kopSuratUrl: (map.kop_surat_url as string) ?? null,
    signatureUrl: (map.signature_url as string) ?? null,
    qrisUrl: (map.qris_url as string) ?? null,
    bankName: (map.bank_name as string) ?? null,
    bankAccountName: (map.bank_account_name as string) ?? null,
    bankAccountNumber: (map.bank_account_number as string) ?? null,
    kelurahan: (map.kelurahan as string) ?? null,
    kecamatan: (map.kecamatan as string) ?? null,
    kota: (map.kota as string) ?? null,
    iuranAmount: map.iuran_amount != null ? Number(map.iuran_amount) : 50000,
    iuranComponents: Array.isArray(map.iuran_components)
      ? (map.iuran_components as any[])
          .map((c) => ({ name: String(c?.name ?? ''), amount: Number(c?.amount ?? 0) }))
          .filter((c) => c.name !== '')
      : [],
    emergencyKetuaPhone: (map.emergency_ketua_phone as string) ?? null,
    emergencyBendaharaPhone: (map.emergency_bendahara_phone as string) ?? null,
    emergencySecurityName: (map.emergency_security_name as string) ?? null,
    emergencySecurityPhone: (map.emergency_security_phone as string) ?? null,
    rondaPerNight: map.ronda_per_night != null ? Number(map.ronda_per_night) : 3,
    rondaStart: (map.ronda_start as string) ?? '22.00',
    rondaEnd: (map.ronda_end as string) ?? '04.00',
    rondaDays: Array.isArray(map.ronda_days) ? (map.ronda_days as any[]).map(Number) : [],
    rondaGroups: Array.isArray(map.ronda_groups)
      ? (map.ronda_groups as any[]).map((g) => ({
          name: String(g?.name ?? ''),
          color: String(g?.color ?? ''),
          memberIds: Array.isArray(g?.memberIds) ? (g.memberIds as any[]).map(String) : [],
        }))
      : [],
  };
}

export function rtDisplayLabel(rt: RtUnit): string {
  const rw = rt.rwNumber != null ? ` RW ${rt.rwNumber}` : '';
  return `RT ${rt.rtNumber}${rw}`;
}

// ── Kas summary ───────────────────────────────────────────────────
export interface KasSummary {
  totalMasuk: number;
  totalKeluar: number;
  saldo: number;
}

export function kasSummaryFromMap(map: Row): KasSummary {
  return {
    totalMasuk: toDouble(map.total_masuk),
    totalKeluar: toDouble(map.total_keluar),
    saldo: toDouble(map.saldo),
  };
}

export const emptyKasSummary = (): KasSummary => ({ totalMasuk: 0, totalKeluar: 0, saldo: 0 });

// ── Announcement ──────────────────────────────────────────────────
export interface Announcement {
  id: string;
  rtId: string;
  authorId: string;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: Date;
  eventDate: Date | null;
  imageUrl: string | null;
  authorName: string | null;
}

export function announcementFromMap(map: Row): Announcement {
  const profiles = map.profiles;
  const eventRaw = map.event_date;
  let eventDate: Date | null = null;
  if (typeof eventRaw === 'string') {
    const iso = eventRaw.includes('T') ? eventRaw : `${eventRaw}T00:00:00`;
    const d = new Date(iso);
    eventDate = isNaN(d.getTime()) ? null : d;
  }
  return {
    id: map.id as string,
    rtId: map.rt_id as string,
    authorId: map.author_id as string,
    title: map.title as string,
    content: map.content as string,
    isPinned: (map.is_pinned as boolean) ?? false,
    createdAt: new Date(map.created_at),
    eventDate,
    imageUrl: (map.image_url as string) ?? null,
    authorName: profiles && typeof profiles === 'object' ? (profiles.full_name ?? null) : null,
  };
}

export const announcementCreatedLabel = (a: Announcement): string => formatDate(a.createdAt);
export const announcementHasImage = (a: Announcement): boolean =>
  a.imageUrl != null && a.imageUrl.trim().length > 0;
export function announcementContentPreview(a: Announcement): string {
  if (a.content.length <= 100) return a.content;
  return `${a.content.slice(0, 100).trim()}…`;
}

// ── Kas transaction ───────────────────────────────────────────────
export interface KasTransaction {
  id: string;
  rtId: string;
  type: string;
  amount: number;
  description: string;
  category: string | null;
  createdAt: Date;
  recorderName: string | null;
}

export function kasTransactionFromMap(map: Row): KasTransaction {
  const profiles = map.profiles;
  return {
    id: map.id as string,
    rtId: map.rt_id as string,
    type: map.type as string,
    amount: toDouble(map.amount),
    description: map.description as string,
    category: (map.category as string) ?? null,
    createdAt: new Date(map.created_at),
    recorderName: profiles && typeof profiles === 'object' ? (profiles.full_name ?? null) : null,
  };
}

export const kasIsIncome = (t: KasTransaction): boolean => t.type === 'masuk';
export const kasDateLabel = (t: KasTransaction): string => formatDateShort(t.createdAt);

// ── Iuran record ──────────────────────────────────────────────────
export interface IuranRecord {
  id: string;
  rtId: string;
  userId: string;
  periodKey: string;
  periodLabel: string;
  amount: number;
  status: string;
  paidAt: Date | null;
  userName: string | null;
  paymentMethod: string | null;
  paymentProofUrl: string | null;
  submittedAt: Date | null;
}

export function iuranRecordFromMap(map: Row): IuranRecord {
  const profiles = map.profiles;
  return {
    id: map.id as string,
    rtId: map.rt_id as string,
    userId: map.user_id as string,
    periodKey: map.period_key as string,
    periodLabel: map.period_label as string,
    amount: toDouble(map.amount),
    status: map.status as string,
    paidAt: map.paid_at ? new Date(map.paid_at) : null,
    userName: profiles && typeof profiles === 'object' ? (profiles.full_name ?? null) : null,
    paymentMethod: (map.payment_method as string) ?? null,
    paymentProofUrl: (map.payment_proof_url as string) ?? null,
    submittedAt: map.submitted_at ? new Date(map.submitted_at) : null,
  };
}

export const iuranIsPaid = (i: IuranRecord): boolean => i.status === 'paid';
export const iuranIsPending = (i: IuranRecord): boolean => i.status === 'pending';
export const iuranIsAwaiting = (i: IuranRecord): boolean => i.status === 'awaiting_verification';
export const iuranIsUnpaid = (i: IuranRecord): boolean => !iuranIsPaid(i) && !iuranIsAwaiting(i);

export function iuranPaymentMethodLabel(i: IuranRecord): string {
  switch (i.paymentMethod) {
    case 'transfer':
      return 'Transfer Bank';
    case 'cash':
      return 'Tunai';
    case 'qris':
    default:
      return 'QRIS';
  }
}

// ── Surat request ─────────────────────────────────────────────────
export interface SuratRequest {
  id: string;
  suratType: string;
  purpose: string;
  status: string;
  createdAt: Date;
  updatedAt: Date | null;
  userName: string | null;
  // Data pengaju/kepala keluarga (dari profil akun, via join) — untuk kartu "Pemohon"
  submitterNik: string | null;
  submitterOccupation: string | null;
  submitterMaritalStatus: string | null;
  submitterAddress: string | null;
  // Nama pemohon bila surat untuk anggota keluarga (null = pakai nama akun) — migrasi 021
  applicantName: string | null;
  // Data subjek surat (diisi warga saat mengajukan; anggota keluarga bila dipilih) — migrasi 015 & 017
  nik: string | null;
  birthPlace: string | null;
  birthDate: string | null;
  occupation: string | null;
  gender: string | null;
  religion: string | null;
  maritalStatus: string | null;
}

export function suratRequestFromMap(map: Row): SuratRequest {
  const profiles = map.profiles;
  return {
    id: map.id as string,
    suratType: map.surat_type as string,
    purpose: map.purpose as string,
    status: map.status as string,
    createdAt: new Date(map.created_at),
    updatedAt: map.updated_at ? new Date(map.updated_at) : null,
    userName: profiles && typeof profiles === 'object' ? (profiles.full_name ?? null) : null,
    submitterNik: profiles && typeof profiles === 'object' ? (profiles.nik ?? null) : null,
    submitterOccupation: profiles && typeof profiles === 'object' ? (profiles.occupation ?? null) : null,
    submitterMaritalStatus: profiles && typeof profiles === 'object' ? (profiles.marital_status ?? null) : null,
    submitterAddress: profiles && typeof profiles === 'object' ? (profiles.address ?? null) : null,
    applicantName: (map.applicant_name as string) ?? null,
    nik: (map.nik as string) ?? null,
    birthPlace: (map.birth_place as string) ?? null,
    birthDate: (map.birth_date as string) ?? null,
    occupation: (map.occupation as string) ?? null,
    gender: (map.gender as string) ?? null,
    religion: (map.religion as string) ?? null,
    maritalStatus: (map.marital_status as string) ?? null,
  };
}

export interface SuratApplicant {
  name?: string;
  nik?: string;
  birthPlace?: string;
  birthDate?: string;
  occupation?: string;
  gender?: string;
  religion?: string;
  maritalStatus?: string;
}

/** Nama pemohon surat: nama anggota keluarga bila ada, jika tidak nama akun. */
export const suratPersonName = (s: SuratRequest, fallback = 'Warga'): string =>
  (s.applicantName && s.applicantName.trim() !== '' ? s.applicantName.trim() : null) ??
  s.userName ??
  fallback;

export const suratIsPending = (s: SuratRequest): boolean => s.status === 'pending';
export const suratIsApproved = (s: SuratRequest): boolean => s.status === 'approved';
export const suratIsRejected = (s: SuratRequest): boolean => s.status === 'rejected';

export function suratStatusLabel(s: SuratRequest): string {
  switch (s.status) {
    case 'approved':
      return 'Disetujui';
    case 'rejected':
      return 'Ditolak';
    default:
      return 'Menunggu';
  }
}

export function suratReferenceCode(s: SuratRequest, rtNumber: string): string {
  const m = String(s.createdAt.getMonth() + 1).padStart(2, '0');
  const seq = String(s.createdAt.getTime() % 1000).padStart(3, '0');
  const rt = rtNumber.replace(/\D/g, '');
  return `SR-${rt}/${m}/${seq}`;
}

// ── Anggota keluarga (dikelola Ketua RT) ─────────────────────────
export interface FamilyMember {
  id: string;
  rtId: string;
  headUserId: string;
  name: string;
  relation: string | null;
  nik: string | null;
  birthPlace: string | null;
  birthDate: string | null;
  gender: string | null;
  religion: string | null;
  maritalStatus: string | null;
  occupation: string | null;
}

export function familyMemberFromMap(map: Row): FamilyMember {
  return {
    id: map.id as string,
    rtId: map.rt_id as string,
    headUserId: map.head_user_id as string,
    name: (map.name as string) ?? '',
    relation: (map.relation as string) ?? null,
    nik: (map.nik as string) ?? null,
    birthPlace: (map.birth_place as string) ?? null,
    birthDate: (map.birth_date as string) ?? null,
    gender: (map.gender as string) ?? null,
    religion: (map.religion as string) ?? null,
    maritalStatus: (map.marital_status as string) ?? null,
    occupation: (map.occupation as string) ?? null,
  };
}
