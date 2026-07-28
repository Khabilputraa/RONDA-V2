// Kas RT — transparansi keuangan RT (Ketua/Bendahara).
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon, type IconName } from '../../components/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { colors, formatRupiah, radius, wargaColors } from '../../config/theme';
import { weekdayDateLabel } from '../../lib/period';
import { WargaEmptyState } from '../../components/warga/PengurusWidgets';
import { PrimaryButton } from '../../components/Card';
import { useToast } from '../../components/Toast';
import { rtService } from '../../services/rtService';
import {
  KasSummary,
  KasTransaction,
  Profile,
  RtUnit,
  emptyKasSummary,
  kasDateLabel,
  kasIsIncome,
  profileIsBendahara,
  profileIsKetua,
  rtDisplayLabel,
} from '../../types/models';

interface Props {
  profile: Profile;
  rt: RtUnit;
}

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

type Filter = 'all' | 'masuk' | 'keluar';

interface MonthGroup {
  key: string;
  month: number;
  label: string;
  items: KasTransaction[];
  masuk: number;
  keluar: number;
}
interface YearGroup {
  year: number;
  count: number;
  masuk: number;
  keluar: number;
  months: MonthGroup[];
}

const sumMasuk = (arr: KasTransaction[]) => arr.filter(kasIsIncome).reduce((s, t) => s + t.amount, 0);
const sumKeluar = (arr: KasTransaction[]) => arr.filter((t) => !kasIsIncome(t)).reduce((s, t) => s + t.amount, 0);

// Kelompokkan: Tahun -> Bulan -> transaksi (terbaru dahulu).
function groupNested(txs: KasTransaction[]): YearGroup[] {
  const yearMap = new Map<number, KasTransaction[]>();
  for (const t of txs) {
    const y = t.createdAt.getFullYear();
    if (!yearMap.has(y)) yearMap.set(y, []);
    yearMap.get(y)!.push(t);
  }
  return Array.from(yearMap.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => {
      const monthMap = new Map<number, KasTransaction[]>();
      for (const t of items) {
        const m = t.createdAt.getMonth();
        if (!monthMap.has(m)) monthMap.set(m, []);
        monthMap.get(m)!.push(t);
      }
      const months: MonthGroup[] = Array.from(monthMap.entries())
        .sort((a, b) => b[0] - a[0])
        .map(([month, mitems]) => ({
          key: `${year}-${month}`,
          month,
          label: BULAN[month],
          items: mitems,
          masuk: sumMasuk(mitems),
          keluar: sumKeluar(mitems),
        }));
      return { year, count: items.length, masuk: sumMasuk(items), keluar: sumKeluar(items), months };
    });
}

export function PengurusKasScreen({ profile, rt }: Props) {
  const toast = useToast();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [kas, setKas] = useState<KasSummary>(emptyKasSummary());
  const [txs, setTxs] = useState<KasTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [isIncome, setIsIncome] = useState(true);
  const [hideAmount, setHideAmount] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [openYears, setOpenYears] = useState<Set<number>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [detailTx, setDetailTx] = useState<KasTransaction | null>(null);
  const canEdit = profileIsKetua(profile) || profileIsBendahara(profile);
  // Warna brand per-role: Ketua hijau, Bendahara oranye. (Nominal masuk/keluar tetap semantik.)
  const brand = profileIsKetua(profile) ? wargaColors.primaryGreen : '#EA580C';
  const brandSoft = profileIsKetua(profile) ? wargaColors.lightGreen : '#FFEDD5';

  const now = new Date();
  const monthLabel = `${BULAN[now.getMonth()]} ${now.getFullYear()}`;
  const masukCount = txs.filter(kasIsIncome).length;
  const keluarCount = txs.length - masukCount;
  const pengeluaranPct = kas.totalMasuk > 0 ? Math.min(100, Math.round((kas.totalKeluar / kas.totalMasuk) * 100)) : 0;
  const sisaPct = 100 - pengeluaranPct;
  const monthsCount = new Set(txs.map((t) => `${t.createdAt.getFullYear()}-${t.createdAt.getMonth()}`)).size;

  const filtered = txs.filter((t) => (filter === 'all' ? true : filter === 'masuk' ? kasIsIncome(t) : !kasIsIncome(t)));
  const years = groupNested(filtered);

  const load = useCallback(async () => {
    const [k, t] = await Promise.all([rtService.getKasSummary(rt.id), rtService.getKasTransactions(rt.id)]);
    setKas(k);
    setTxs(t);
    setOpenYears(new Set(t.length ? [t[0].createdAt.getFullYear()] : []));
    setLoading(false);
    setRefreshing(false);
  }, [rt.id]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (amount: number, desc: string) => {
    if (!(amount > 0)) { toast.error('Nominal harus lebih dari 0'); return; }
    try {
      await rtService.addKasTransaction({
        rtId: rt.id,
        type: isIncome ? 'masuk' : 'keluar',
        amount,
        description: desc.trim() || (isIncome ? 'Pemasukan' : 'Pengeluaran'),
        category: isIncome ? 'pemasukan' : 'pengeluaran',
      });
      setAddOpen(false);
      await load();
      toast.success('Transaksi tersimpan');
    } catch (e: any) {
      toast.error(`Gagal menyimpan: ${String(e?.message ?? e)}`);
    }
  };

  const toggleYear = (y: number) =>
    setOpenYears((prev) => {
      const next = new Set(prev);
      next.has(y) ? next.delete(y) : next.add(y);
      return next;
    });
  const toggleMonth = (k: string) =>
    setOpenMonths((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.headIcon, { backgroundColor: brandSoft }]}><Icon name="wallet" size={18} color={brand} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headTitle}>Kas RT</Text>
          <Text style={styles.headSub}>Transparansi keuangan {rtDisplayLabel(rt)}</Text>
        </View>
        {canEdit && (
          <Pressable onPress={() => setAddOpen(true)} hitSlop={8} style={[styles.addBtn, { backgroundColor: brandSoft }]}>
            <Icon name="add" size={22} color={brand} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.emerald} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.emerald} />}
        >
          {/* Saldo card */}
          <View style={[styles.saldoCard, { backgroundColor: brand }]}>
            <View style={styles.saldoTop}>
              <View style={styles.saldoLabelRow}>
                <Icon name="wallet-outline" size={14} color="rgba(255,255,255,0.9)" />
                <Text style={styles.saldoLabel}>Saldo Kas RT</Text>
              </View>
              <Pressable onPress={() => setHideAmount((v) => !v)} hitSlop={8} style={styles.eyeBtn}>
                <Icon name={hideAmount ? 'eye-off-outline' : 'eye-outline'} size={16} color="#fff" />
              </Pressable>
            </View>
            <Text style={styles.saldoValue}>{hideAmount ? 'Rp •••••••' : formatRupiah(kas.saldo)}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${sisaPct}%` }]} />
            </View>
            <View style={styles.saldoBottom}>
              <Text style={styles.saldoBottomText}>Pengeluaran {pengeluaranPct}%</Text>
              <Text style={styles.saldoBottomText}>Sisa {sisaPct}%</Text>
            </View>
          </View>

          {/* Pemasukan / Pengeluaran */}
          <View style={styles.miniRow}>
            <View style={[styles.miniCard]}>
              <View style={styles.miniLabelRow}>
                <Icon name="arrow-back" size={13} color={wargaColors.primaryGreen} style={{ transform: [{ rotate: '135deg' }] }} />
                <Text style={styles.miniLabel}>Pemasukan</Text>
              </View>
              <Text style={[styles.miniValue, { color: wargaColors.primaryGreen }]}>{formatRupiah(kas.totalMasuk)}</Text>
              <Text style={styles.miniMonth}>{monthLabel}</Text>
            </View>
            <View style={[styles.miniCard]}>
              <View style={styles.miniLabelRow}>
                <Icon name="arrow-down-outline" size={13} color={wargaColors.dangerRed} />
                <Text style={styles.miniLabel}>Pengeluaran</Text>
              </View>
              <Text style={[styles.miniValue, { color: wargaColors.dangerRed }]}>{formatRupiah(kas.totalKeluar)}</Text>
              <Text style={styles.miniMonth}>{monthLabel}</Text>
            </View>
          </View>

          {/* Laporan Bulanan */}
          <Pressable style={styles.laporanCard} onPress={() => navigation.navigate('LaporanBulanan', { profile, rt })}>
            <View style={styles.laporanIcon}><Icon name="document-text-outline" size={20} color="#fff" /></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.laporanTitle}>Laporan Bulanan</Text>
              <Text style={styles.laporanSub}>Download PDF laporan kas {monthLabel}</Text>
            </View>
            <Icon name="download-outline" size={20} color="#fff" />
          </Pressable>

          {/* Filter */}
          <View style={styles.segment}>
            <FilterTab label="Semua" active={filter === 'all'} activeColor={brand} onPress={() => setFilter('all')} />
            <FilterTab label={`${masukCount} Masuk`} active={filter === 'masuk'} activeColor={brand} onPress={() => setFilter('masuk')} />
            <FilterTab label={`${keluarCount} Keluar`} active={filter === 'keluar'} activeColor={brand} onPress={() => setFilter('keluar')} />
          </View>

          {/* Riwayat Transaksi */}
          {txs.length === 0 ? (
            <WargaEmptyState icon="receipt-outline" message={'Belum ada transaksi.\nTambah lewat tombol + di atas.'} />
          ) : (
            <View style={styles.riwayatCard}>
              <View style={styles.riwayatHead}>
                <View style={styles.riwayatIcon}><Icon name="receipt" size={16} color={wargaColors.primaryGreen} /></View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.riwayatTitle}>Riwayat Transaksi</Text>
                  <Text style={styles.riwayatSub}>{monthsCount} bulan • {txs.length} transaksi</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.totMasuk}>+{formatRupiah(kas.totalMasuk)}</Text>
                  <Text style={styles.totKeluar}>-{formatRupiah(kas.totalKeluar)}</Text>
                </View>
              </View>

              {years.map((yg) => {
                const yOpen = openYears.has(yg.year);
                return (
                  <View key={yg.year}>
                    <Pressable style={styles.yearRow} onPress={() => toggleYear(yg.year)}>
                      <Icon name={yOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textSecondary} />
                      <Icon name="calendar-outline" size={15} color={colors.textSecondary} />
                      <Text style={styles.yearText}>{yg.year}</Text>
                      <Text style={styles.yearCount}>{yg.count} transaksi</Text>
                      <View style={{ flex: 1 }} />
                      <Text style={styles.totMasukSm}>+{formatRupiah(yg.masuk)}</Text>
                      <Text style={styles.totKeluarSm}>-{formatRupiah(yg.keluar)}</Text>
                    </Pressable>
                    {yOpen &&
                      yg.months.map((mg) => {
                        const mOpen = openMonths.has(mg.key);
                        return (
                          <View key={mg.key} style={styles.monthBlock}>
                            <Pressable style={styles.monthRow} onPress={() => toggleMonth(mg.key)}>
                              <Icon name={mOpen ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textSecondary} />
                              <Text style={styles.monthName}>{mg.label}</Text>
                              <Text style={styles.monthCount}>{mg.items.length} tx</Text>
                              <View style={{ flex: 1 }} />
                              <Text style={styles.totMasukSm}>+{formatRupiah(mg.masuk)}</Text>
                              <Text style={styles.totKeluarSm}>-{formatRupiah(mg.keluar)}</Text>
                            </Pressable>
                            {mOpen &&
                              mg.items.map((t) => (
                                <Pressable key={t.id} style={styles.txRow} onPress={() => setDetailTx(t)}>
                                  <Icon name={kasIsIncome(t) ? 'checkmark-circle' : 'remove-circle-outline'} size={20} color={kasIsIncome(t) ? wargaColors.primaryGreen : wargaColors.dangerRed} />
                                  <View style={{ flex: 1, marginLeft: 10 }}>
                                    <Text style={styles.txTitle}>{t.description}</Text>
                                    <Text style={styles.txDate}>{kasDateLabel(t)}</Text>
                                  </View>
                                  <Text style={[styles.txAmount, { color: kasIsIncome(t) ? wargaColors.primaryGreen : wargaColors.dangerRed }]}>
                                    {kasIsIncome(t) ? '+' : '-'}{formatRupiah(t.amount)}
                                  </Text>
                                </Pressable>
                              ))}
                          </View>
                        );
                      })}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      <KasFormModal
        visible={addOpen}
        isIncome={isIncome}
        onToggle={setIsIncome}
        onClose={() => setAddOpen(false)}
        onSubmit={submit}
      />

      <KasDetailModal tx={detailTx} onClose={() => setDetailTx(null)} />
    </SafeAreaView>
  );
}

function FilterTab({ label, active, activeColor, onPress }: { label: string; active: boolean; activeColor?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.filterTab, active && styles.filterTabActive, active && activeColor ? { backgroundColor: activeColor } : null]}>
      <Text style={[styles.filterText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

function KasDetailModal({ tx, onClose }: { tx: KasTransaction | null; onClose: () => void }) {
  if (!tx) return null;
  const income = kasIsIncome(tx);
  const accent = income ? wargaColors.primaryGreen : wargaColors.dangerRed;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const kategori = tx.category ? cap(tx.category) : income ? 'Pemasukan' : 'Pengeluaran';
  const shortId = tx.id.length > 12 ? `${tx.id.slice(0, 8)}…` : tx.id;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.dBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.dCard}>
          <View style={[styles.dAccent, { backgroundColor: accent }]} />
          <View style={styles.dHeader}>
            <View style={[styles.dHeadIcon, { backgroundColor: income ? wargaColors.lightGreen : '#FEE2E2' }]}>
              <Icon name={income ? 'trending-up' : 'trending-down'} size={20} color={accent} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.dTitle}>Detail Transaksi</Text>
              <Text style={styles.dSub}>{income ? 'Pemasukan' : 'Pengeluaran'}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.dCloseBtn}>
              <Icon name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>

          <Text style={[styles.dAmount, { color: accent }]}>
            {income ? '+' : '-'}{formatRupiah(tx.amount)}
          </Text>

          <DetailRow label="Deskripsi" value={tx.description} />
          <DetailRow label="Kategori">
            <View style={[styles.dBadge, { backgroundColor: income ? wargaColors.lightGreen : '#FEE2E2' }]}>
              <Text style={[styles.dBadgeText, { color: accent }]}>{kategori}</Text>
            </View>
          </DetailRow>
          <DetailRow label="Tanggal" value={weekdayDateLabel(tx.createdAt)} />
          {tx.recorderName ? <DetailRow label="Dicatat oleh" value={tx.recorderName} /> : null}
          <DetailRow label="ID Transaksi" value={shortId} last dim />
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({
  label,
  value,
  children,
  last,
  dim,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
  last?: boolean;
  dim?: boolean;
}) {
  return (
    <View style={[styles.dRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.dRowLabel}>{label}</Text>
      {children ?? <Text style={[styles.dRowValue, dim && styles.dRowValueDim]}>{value}</Text>}
    </View>
  );
}

function KasFormModal({
  visible,
  isIncome,
  onToggle,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  isIncome: boolean;
  onToggle: (v: boolean) => void;
  onClose: () => void;
  onSubmit: (amount: number, desc: string) => Promise<void>;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const val = parseFloat(amount.replace(/\D/g, ''));
    if (isNaN(val) || val <= 0) return toast.error('Nominal tidak valid');
    if (desc.trim() === '') return toast.error('Keterangan wajib');
    setSaving(true);
    try {
      await onSubmit(val, desc.trim());
      setAmount('');
      setDesc('');
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.handle} />
            <View style={styles.toggle}>
              <Pressable onPress={() => onToggle(true)} style={[styles.toggleBtn, isIncome && styles.toggleActive]}>
                <Text style={[styles.toggleText, isIncome && { color: wargaColors.primaryGreen }]}>Pemasukan</Text>
              </Pressable>
              <Pressable onPress={() => onToggle(false)} style={[styles.toggleBtn, !isIncome && styles.toggleActive]}>
                <Text style={[styles.toggleText, !isIncome && { color: wargaColors.dangerRed }]}>Pengeluaran</Text>
              </Pressable>
            </View>
            <Text style={styles.mLabel}>Nominal</Text>
            <TextInput style={styles.mInput} value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.textHint} />
            <Text style={styles.mLabel}>Keterangan</Text>
            <TextInput style={styles.mInput} value={desc} onChangeText={setDesc} placeholder="Contoh: Beli lampu jalan" placeholderTextColor={colors.textHint} />
            <View style={{ height: 20 }} />
            <PrimaryButton label={saving ? 'Menyimpan...' : 'Simpan Transaksi'} onPress={submit} loading={saving} />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: wargaColors.bgColor },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  headIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: wargaColors.lightGreen, alignItems: 'center', justifyContent: 'center' },
  headTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  headSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  addBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: wargaColors.lightGreen, alignItems: 'center', justifyContent: 'center' },
  saldoCard: { backgroundColor: wargaColors.primaryGreen, borderRadius: 18, padding: 18 },
  saldoTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  saldoLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  saldoLabel: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  eyeBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  saldoValue: { fontSize: 28, fontWeight: '800', color: '#fff', marginTop: 8 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 16, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: '#fff' },
  saldoBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  saldoBottomText: { fontSize: 11, color: 'rgba(255,255,255,0.85)' },
  miniRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  miniCard: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14 },
  miniLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniLabel: { fontSize: 12, color: colors.textSecondary },
  miniValue: { fontSize: 18, fontWeight: '800', marginTop: 8 },
  miniMonth: { fontSize: 11, color: colors.textHint, marginTop: 2 },
  laporanCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1F2937', borderRadius: 16, padding: 16, marginTop: 12 },
  laporanIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  laporanTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  laporanSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  segment: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 4, gap: 4, marginTop: 16, marginBottom: 14 },
  filterTab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 10 },
  filterTabActive: { backgroundColor: wargaColors.primaryGreen },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  riwayatCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14 },
  riwayatHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 6 },
  riwayatIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: wargaColors.lightGreen, alignItems: 'center', justifyContent: 'center' },
  riwayatTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  riwayatSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  totMasuk: { fontSize: 12, fontWeight: '700', color: wargaColors.primaryGreen },
  totKeluar: { fontSize: 12, fontWeight: '700', color: wargaColors.dangerRed, marginTop: 1 },
  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  yearText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  yearCount: { fontSize: 11, color: colors.textSecondary },
  totMasukSm: { fontSize: 11, fontWeight: '600', color: wargaColors.primaryGreen, marginRight: 8 },
  totKeluarSm: { fontSize: 11, fontWeight: '600', color: wargaColors.dangerRed },
  monthBlock: { marginLeft: 8 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingLeft: 4, borderTopWidth: 1, borderTopColor: colors.background },
  monthName: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  monthCount: { fontSize: 11, color: colors.textSecondary },
  txRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingLeft: 8, borderTopWidth: 1, borderTopColor: colors.background },
  txTitle: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  txDate: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  txAmount: { fontSize: 13, fontWeight: '700' },
  dBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  dCard: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 20, paddingBottom: 8, paddingTop: 22, overflow: 'hidden' },
  dAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  dHeader: { flexDirection: 'row', alignItems: 'center' },
  dHeadIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  dSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  dCloseBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  dAmount: { fontSize: 26, fontWeight: '800', textAlign: 'center', marginVertical: 18 },
  dRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  dRowLabel: { fontSize: 13, color: colors.textSecondary, marginRight: 12 },
  dRowValue: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary, textAlign: 'right' },
  dRowValueDim: { fontWeight: '400', color: colors.textHint },
  dBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  dBadgeText: { fontSize: 12, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 16 },
  toggle: { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 12, padding: 4 },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  toggleActive: { backgroundColor: '#fff' },
  toggleText: { fontWeight: '600', fontSize: 13, color: colors.textSecondary },
  mLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 16, marginBottom: 6 },
  mInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
});
