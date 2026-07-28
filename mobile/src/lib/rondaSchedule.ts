// Jadwal ronda OTOMATIS berbasis KELOMPOK (grup).
// Warga dibagi jadi beberapa grup (ukuran = petugas/malam), lalu grup bergilir
// tiap malam. Deterministik (berbasis tanggal), tanpa input manual.

export interface RondaPerson {
  id: string;
  name: string;
  no: number; // nomor urut warga (untuk label "No. 006")
  phone?: string;
  avatarUrl?: string | null;
}

export interface RondaGroup {
  index: number; // 1-based (Grup 1, Grup 2, ...)
  name?: string; // nama kustom (grup manual)
  color?: string; // warna kustom (grup manual)
  members: RondaPerson[];
}

export interface RawGroup {
  name: string;
  color: string;
  memberIds: string[];
}

export interface RondaNight {
  date: Date;
  dateKey: string; // YYYY-MM-DD
  groupIndex: number; // grup yang bertugas
  petugas: RondaPerson[];
}

export interface RondaOptions {
  perNight?: number; // ukuran grup (default 3)
  days?: number; // jendela hari ke depan (default 21)
  startFrom?: Date;
  weekdays?: number[]; // 0=Minggu..6=Sabtu; kosong = tiap malam
}

const EPOCH = Date.UTC(2024, 0, 1) / 86400000;

export function dayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) - EPOCH;
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Bagi warga jadi grup berukuran `size` (urut nama agar stabil). */
export function buildGroups(people: RondaPerson[], size: number): RondaGroup[] {
  const list = [...people].filter((p) => p.name.trim() !== '').sort((a, b) => a.name.localeCompare(b.name));
  const n = list.length;
  if (n === 0) return [];
  const s = Math.max(1, Math.min(size, n));
  const groups: RondaGroup[] = [];
  for (let i = 0; i < n; i += s) {
    groups.push({ index: groups.length + 1, members: list.slice(i, i + s) });
  }
  return groups;
}

/** Ubah grup manual (RawGroup dari DB) → RondaGroup dengan anggota ter-resolve. */
export function resolveGroups(raw: RawGroup[], people: RondaPerson[]): RondaGroup[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  return raw
    .map((g, i) => ({
      index: i + 1,
      name: g.name || `Grup ${i + 1}`,
      color: g.color || undefined,
      members: g.memberIds.map((id) => byId.get(id)).filter((p): p is RondaPerson => !!p),
    }))
    .filter((g) => g.members.length > 0);
}

/** Warga yang belum masuk grup mana pun (mode manual). */
export function unassignedPeople(raw: RawGroup[], people: RondaPerson[]): RondaPerson[] {
  const assigned = new Set(raw.flatMap((g) => g.memberIds));
  return people.filter((p) => !assigned.has(p.id));
}

/** Grup yang bertugas pada tanggal tertentu (1-based). numGroups > 0. */
export function groupIndexOnDate(date: Date, numGroups: number): number {
  if (numGroups <= 0) return 0;
  const d = dayNumber(date);
  return (((d % numGroups) + numGroups) % numGroups) + 1;
}

/** Jadwal malam ronda untuk jendela `days` (difilter hari ronda bila diset). */
export function generateNights(groups: RondaGroup[], opts: RondaOptions = {}): RondaNight[] {
  if (groups.length === 0) return [];
  const days = opts.days ?? 21;
  const weekdays = opts.weekdays && opts.weekdays.length > 0 ? opts.weekdays : null;
  const start = opts.startFrom ? new Date(opts.startFrom) : new Date();
  start.setHours(0, 0, 0, 0);

  const out: RondaNight[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    if (weekdays && !weekdays.includes(date.getDay())) continue;
    const gi = groupIndexOnDate(date, groups.length);
    out.push({ date, dateKey: ymd(date), groupIndex: gi, petugas: groups[gi - 1].members });
  }
  return out;
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const HARI_SHORT = ['MIN', 'SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB'];
const BULAN_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function rondaDateLabel(d: Date): string {
  return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}
export function rondaHari(d: Date): string {
  return HARI[d.getDay()];
}
export function rondaShortDate(d: Date): string {
  return `${d.getDate()} ${BULAN_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

// Palet warna grup (dipakai picker & warna default).
export const GROUP_COLORS = ['#059669', '#D97706', '#2563EB', '#7C3AED', '#E11D48', '#0D9488', '#EA580C', '#0891B2'];
export function groupColor(index: number): string {
  return GROUP_COLORS[(index - 1) % GROUP_COLORS.length];
}

export const RONDA_DEFAULT_JAM = '22.00 - 04.00';
