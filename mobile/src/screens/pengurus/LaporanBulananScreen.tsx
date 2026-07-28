// Laporan Bulanan — rekap keuangan RT per bulan (dibuka dari Kas RT).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors, formatRupiah, wargaColors } from '../../config/theme';
import { useToast } from '../../components/Toast';
import { rtService } from '../../services/rtService';
import { buildLaporanKasHtml, LaporanLine, LaporanKk } from '../../lib/laporanKasHtml';
import { exportLongHtmlAsPdf } from '../../lib/suratPdf';
import {
  IuranRecord,
  KasSummary,
  KasTransaction,
  Profile,
  RtUnit,
  emptyKasSummary,
  iuranIsPaid,
  kasIsIncome,
  profileIsBendahara,
  profileIsKetua,
} from '../../types/models';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'LaporanBulanan'>;

// Dipakai sebagai stack screen (dari Beranda/Kas) — membungkus view.
export default function LaporanBulananScreen({ route, navigation }: Props) {
  return <LaporanBulananView profile={route.params.profile} rt={route.params.rt} onBack={() => navigation.goBack()} />;
}

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

interface MonthRow {
  key: string;
  label: string;
  masuk: number;
  keluar: number;
  saldo: number;
  paid: number;
  total: number;
}

// View Laporan Bulanan — bisa dipakai sebagai tab (dengan onBack ke Beranda).
export function LaporanBulananView({ profile, rt, onBack }: { profile: Profile; rt: RtUnit; onBack?: () => void }) {
  const toast = useToast();
  const brand = profileIsBendahara(profile) ? '#EA580C' : wargaColors.primaryGreen;
  const [kas, setKas] = useState<KasSummary>(emptyKasSummary());
  const [rows, setRows] = useState<MonthRow[]>([]);
  const [allTxs, setAllTxs] = useState<KasTransaction[]>([]);
  const [allBills, setAllBills] = useState<IuranRecord[]>([]);
  const [ketuaName, setKetuaName] = useState(profileIsKetua(profile) ? profile.fullName : '');
  const [bendaharaName, setBendaharaName] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [k, txs, bills, pengurus] = await Promise.all([
      rtService.getKasSummary(rt.id),
      rtService.getKasTransactions(rt.id, 500),
      rtService.getIuranRecords(rt.id),
      rtService.getRtPengurus(rt.id).catch(() => []),
    ]);
    setKas(k);
    setAllTxs(txs as KasTransaction[]);
    setAllBills(bills);
    const ketua = pengurus.find(profileIsKetua);
    const bendahara = pengurus.find(profileIsBendahara);
    if (ketua) setKetuaName(ketua.fullName);
    if (bendahara) setBendaharaName(bendahara.fullName);

    const iuranByPeriod = new Map<string, { paid: number; total: number }>();
    for (const b of bills) {
      let e = iuranByPeriod.get(b.periodKey);
      if (!e) { e = { paid: 0, total: 0 }; iuranByPeriod.set(b.periodKey, e); }
      e.total += 1;
      if (iuranIsPaid(b)) e.paid += 1;
    }

    const map = new Map<string, { y: number; m: number; masuk: number; keluar: number }>();
    for (const t of txs as KasTransaction[]) {
      const y = t.createdAt.getFullYear();
      const m = t.createdAt.getMonth();
      const key = `${y}-${String(m + 1).padStart(2, '0')}`;
      let e = map.get(key);
      if (!e) { e = { y, m, masuk: 0, keluar: 0 }; map.set(key, e); }
      if (kasIsIncome(t)) e.masuk += t.amount;
      else e.keluar += t.amount;
    }

    const asc = Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    let run = 0;
    const rowsAsc: MonthRow[] = asc.map(([key, e]) => {
      run += e.masuk - e.keluar;
      const per = iuranByPeriod.get(key) ?? { paid: 0, total: 0 };
      return { key, label: `${BULAN[e.m]} ${e.y}`, masuk: e.masuk, keluar: e.keluar, saldo: run, paid: per.paid, total: per.total };
    });
    setRows(rowsAsc.reverse());
    setLoading(false);
  }, [rt.id]);

  useEffect(() => { load(); }, [load]);

  const shortDate = (d: Date) => `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;

  const downloadPdf = async (r: MonthRow) => {
    setDownloading(r.key);
    try {
      const [ys, ms] = r.key.split('-');
      const Y = Number(ys);
      const M0 = Number(ms) - 1;
      const inMonth = (d: Date | null) => d != null && d.getFullYear() === Y && d.getMonth() === M0;

      // Buku kas bulan ini
      const monthTxs = allTxs.filter((t) => inMonth(t.createdAt));
      const isIuranTx = (t: KasTransaction) =>
        `${t.category ?? ''} ${t.description ?? ''}`.toLowerCase().includes('iuran');
      const pemasukanLain: LaporanLine[] = monthTxs
        .filter((t) => kasIsIncome(t) && !isIuranTx(t))
        .map((t, i) => ({ no: i + 1, keterangan: t.description || 'Pemasukan lain', tgl: shortDate(t.createdAt), amount: t.amount }));
      const pengeluaran: LaporanLine[] = monthTxs
        .filter((t) => !kasIsIncome(t))
        .map((t, i) => ({ no: i + 1, keterangan: t.description || 'Pengeluaran', tgl: shortDate(t.createdAt), amount: t.amount }));

      // Iuran yang UANGNYA diterima bulan ini (cash basis: paid_at di bulan ini)
      const paidInMonth = allBills.filter((b) => inMonth(b.paidAt));
      const iuranPeriodIni: LaporanLine[] = paidInMonth
        .filter((b) => b.periodKey === r.key)
        .map((b, i) => ({ no: i + 1, keterangan: b.userName ?? 'Warga', tgl: b.paidAt ? shortDate(b.paidAt) : '-', amount: b.amount }));
      const periodeLainBills = paidInMonth.filter((b) => b.periodKey !== r.key);
      const iuranPeriodeLain: LaporanLine[] = periodeLainBills.map((b, i) => ({
        no: i + 1,
        keterangan: `Iuran ${b.periodLabel || b.periodKey} - ${b.userName ?? 'Warga'}`,
        sub: b.periodLabel || b.periodKey,
        tgl: b.paidAt ? shortDate(b.paidAt) : '-',
        amount: b.amount,
      }));
      const totalIuranPeriodeLain = periodeLainBills.reduce((s, b) => s + b.amount, 0);

      // Status iuran untuk periode ini
      const periodBills = allBills.filter((b) => b.periodKey === r.key);
      const targetIuran = periodBills.reduce((s, b) => s + b.amount, 0);
      const realisasiIuran = periodBills.filter(iuranIsPaid).reduce((s, b) => s + b.amount, 0);
      const belumBills = periodBills.filter((b) => !iuranIsPaid(b));
      const kkBelum: LaporanKk[] = belumBills.map((b, i) => ({ no: i + 1, name: b.userName ?? 'Warga', amount: b.amount }));

      const reconKasIuran = paidInMonth.reduce((s, b) => s + b.amount, 0);

      const html = buildLaporanKasHtml({
        rt,
        monthLabel: r.label,
        saldoAwal: r.saldo - r.masuk + r.keluar,
        totalMasuk: r.masuk,
        totalKeluar: r.keluar,
        saldoAkhir: r.saldo,
        iuranPeriodIni,
        iuranPeriodeLain,
        totalIuranPeriodeLain,
        pemasukanLain,
        totalPemasukanLain: pemasukanLain.reduce((s, l) => s + l.amount, 0),
        pengeluaran,
        totalPengeluaran: pengeluaran.reduce((s, l) => s + l.amount, 0),
        targetIuran,
        realisasiIuran,
        lunasCount: periodBills.filter(iuranIsPaid).length,
        belumCount: belumBills.length,
        kkBelum,
        iuranJenis: rt.iuranComponents.map((c) => c.name).filter(Boolean),
        totalTunggakan: belumBills.reduce((s, b) => s + b.amount, 0),
        reconPaidPeriode: realisasiIuran,
        reconKasIuran,
        selisih: realisasiIuran - reconKasIuran,
        ketuaName: ketuaName || profile.fullName,
        bendaharaName,
        phone: rt.emergencyKetuaPhone,
      });
      await exportLongHtmlAsPdf(html, `Laporan Keuangan ${r.label}`, `Laporan-Keuangan-${r.label}.pdf`);
    } catch (e: any) {
      toast.error(`Gagal membuat PDF: ${String(e?.message ?? e)}`);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* Header (oranye untuk Bendahara) */}
      <View style={[styles.greenHeader, { backgroundColor: brand }]}>
        <View style={styles.headRow}>
          {onBack && (
            <Pressable onPress={onBack} hitSlop={8} style={styles.backBtn}>
              <Icon name="chevron-back" size={20} color="#fff" />
            </Pressable>
          )}
          <View style={styles.headIcon}><Icon name="receipt" size={18} color="#fff" /></View>
          <View>
            <Text style={styles.headTitle}>Laporan Bulanan</Text>
            <Text style={styles.headSub}>Rekap keuangan per bulan</Text>
          </View>
        </View>

        <View style={styles.totalCard}>
          <View style={styles.totalLabelRow}>
            <Icon name="wallet-outline" size={13} color="rgba(255,255,255,0.9)" />
            <Text style={styles.totalLabel}>TOTAL SALDO</Text>
          </View>
          <Text style={styles.totalValue}>{formatRupiah(kas.saldo)}</Text>
          <View style={styles.totalSubRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.totalSubLabel}>↗ TOTAL MASUK</Text>
              <Text style={styles.totalSubValue}>{formatRupiah(kas.totalMasuk)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.totalSubLabel}>↘ TOTAL KELUAR</Text>
              <Text style={styles.totalSubValue}>{formatRupiah(kas.totalKeluar)}</Text>
            </View>
          </View>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.emerald} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Rincian Per Bulan</Text>
            <View style={styles.countBadge}><Text style={styles.countText}>{rows.length} bulan</Text></View>
          </View>

          {rows.length === 0 ? (
            <Text style={styles.empty}>Belum ada transaksi kas.</Text>
          ) : (
            rows.map((r) => {
              const pct = r.total > 0 ? Math.round((r.paid / r.total) * 100) : 0;
              return (
                <View key={r.key} style={styles.monthCard}>
                  <View style={styles.monthHead}>
                    <Text style={styles.monthTitle}>{r.label}</Text>
                    <Pressable style={styles.pdfBtn} onPress={() => downloadPdf(r)} disabled={downloading === r.key}>
                      {downloading === r.key ? (
                        <ActivityIndicator size="small" color={wargaColors.primaryGreen} />
                      ) : (
                        <Icon name="download-outline" size={14} color={wargaColors.primaryGreen} />
                      )}
                      <Text style={styles.pdfText}>PDF</Text>
                    </Pressable>
                  </View>
                  <View style={styles.mkRow}>
                    <View style={[styles.mkTile, { backgroundColor: wargaColors.lightGreen }]}>
                      <Text style={styles.mkLabel}>↗ Pemasukan</Text>
                      <Text style={[styles.mkValue, { color: wargaColors.primaryGreen }]}>{formatRupiah(r.masuk)}</Text>
                    </View>
                    <View style={[styles.mkTile, { backgroundColor: '#FEF2F2' }]}>
                      <Text style={styles.mkLabel}>↘ Pengeluaran</Text>
                      <Text style={[styles.mkValue, { color: wargaColors.dangerRed }]}>{formatRupiah(r.keluar)}</Text>
                    </View>
                  </View>
                  <View style={styles.saldoRow}>
                    <Text style={styles.saldoLabel}>Saldo</Text>
                    <Text style={styles.saldoValue}>{formatRupiah(r.saldo)}</Text>
                  </View>
                  <View style={styles.realisasiRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon name="checkmark-circle" size={15} color={wargaColors.primaryGreen} />
                      <Text style={styles.realisasiLabel}>Realisasi Iuran</Text>
                    </View>
                    <Text style={styles.realisasiPct}>{pct}%</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.realisasiNote}>{r.paid} dari {r.total} KK lunas iuran</Text>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: wargaColors.bgColor },
  center: { paddingVertical: 60, alignItems: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },
  greenHeader: { backgroundColor: wargaColors.primaryGreen, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 18, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  headSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 1 },
  totalCard: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 16, marginTop: 16 },
  totalLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  totalLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.9)', letterSpacing: 0.5 },
  totalValue: { fontSize: 26, fontWeight: '800', color: '#fff', marginTop: 6 },
  totalSubRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  totalSubLabel: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.3 },
  totalSubValue: { fontSize: 15, fontWeight: '700', color: '#fff', marginTop: 3 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  countBadge: { backgroundColor: wargaColors.lightGreen, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  countText: { fontSize: 11, fontWeight: '600', color: wargaColors.primaryGreen },
  empty: { color: colors.textSecondary, textAlign: 'center', paddingVertical: 40 },
  monthCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16, marginBottom: 12 },
  monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  monthTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: wargaColors.lightGreen, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  pdfText: { fontSize: 12, fontWeight: '600', color: wargaColors.primaryGreen },
  mkRow: { flexDirection: 'row', gap: 12 },
  mkTile: { flex: 1, borderRadius: 12, padding: 12 },
  mkLabel: { fontSize: 12, color: colors.textSecondary },
  mkValue: { fontSize: 15, fontWeight: '800', marginTop: 4 },
  saldoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  saldoLabel: { fontSize: 13, color: colors.textSecondary },
  saldoValue: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  realisasiRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  realisasiLabel: { fontSize: 13, color: colors.textSecondary },
  realisasiPct: { fontSize: 13, fontWeight: '700', color: wargaColors.primaryGreen },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.background, overflow: 'hidden', marginTop: 8 },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: wargaColors.primaryGreen },
  realisasiNote: { fontSize: 11, color: colors.textSecondary, marginTop: 8 },
});
