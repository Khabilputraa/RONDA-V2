// Port dari lib/pages/warga/warga_home_view.dart
import React, { useCallback, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { suratItemByTypeKey } from '../../lib/suratCatalog';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, wargaColors } from '../../config/theme';
import { useToast } from '../../components/Toast';
import type { RootStackParamList } from '../../navigation/types';
import {
  WargaAksiCepatGrid,
  WargaBerandaHeader,
  WargaDaruratBanner,
  WargaHomeStatsRow,
  WargaPapanInfoHeader,
  WargaPapanInfoStrip,
  WargaSectionHeader,
  WargaTotalTagihanCard,
  type PapanStripProps,
} from '../../components/warga/BerandaWidgets';
import { wargaHomeLoader } from '../../services/wargaHomeLoader';
import { WargaHomeData, emptyWargaHomeData } from '../../types/wargaHomeData';
import {
  awaitingVerification,
  bulanTertunggak,
  paidCount,
  totalKontribusi,
  totalTagihan,
} from '../../types/wargaHomeData';
import {
  Announcement,
  IuranRecord,
  Profile,
  RtUnit,
  SuratRequest,
  iuranIsAwaiting,
  iuranIsUnpaid,
  iuranPaymentMethodLabel,
  rtDisplayLabel,
  suratIsApproved,
  suratIsRejected,
  suratReferenceCode,
  suratStatusLabel,
} from '../../types/models';
import { formatRupiah } from '../../config/theme';
import { greetingByTime, formatDateShort, daysLateFromPeriodKey } from '../../lib/date';
import { iuranPeriodTitle } from '../../lib/period';
import { announcementActive, billActive, suratOnBoard } from '../../lib/papanInfo';
import { AnnouncementDetailSheet } from '../../components/warga/AnnouncementDetailSheet';

interface Props {
  profile: Profile;
  rt: RtUnit;
  onNavigateTab: (i: number) => void;
  onRtSwitched: () => void;
}

export function WargaHomeScreen({ profile, rt, onNavigateTab, onRtSwitched }: Props) {
  const toast = useToast();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [data, setData] = useState<WargaHomeData>(emptyWargaHomeData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailSurat, setDetailSurat] = useState<SuratRequest | null>(null);
  const [detailBill, setDetailBill] = useState<IuranRecord | null>(null);
  const [detailInfo, setDetailInfo] = useState<Announcement | null>(null);

  const openBayarIuran = useCallback(() => {
    navigation.navigate('WargaTagihanIuran', {
      profile,
      rt,
      onDone: () => {
        wargaHomeLoader.invalidate();
        load(true);
        toast.success('Bukti pembayaran terkirim! Menunggu verifikasi Bendahara.');
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, profile, rt]);

  const load = useCallback(
    async (force = false) => {
      try {
        const d = await wargaHomeLoader.load(rt.id, profile.id, force);
        setData(d);
      } catch {
        toast.error('Gagal memuat beranda');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [rt.id, profile.id, toast],
  );

  // Muat ulang tiap Beranda kembali fokus (mis. setelah ajukan surat / bayar iuran).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const unpaid = data.bills.filter(iuranIsUnpaid);
  const awaiting = awaitingVerification(data);
  const daysLate = maxDaysLate(unpaid);

  const strips = buildPapanStrips();

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
      >
        <WargaBerandaHeader
          greetingLine={`${greetingByTime()} 👋`}
          fullName={profile.fullName}
          roleRtLine={`Warga · ${rtDisplayLabel(rt)}`}
          avatarUrl={profile.avatarUrl}
          notifCount={data.announcements.filter(announcementActive).length}
          onNotifTap={() => onNavigateTab(2)}
        />

        <View style={{ height: 16 }} />

        <WargaTotalTagihanCard
          total={totalTagihan(data)}
          bulanTertunggak={bulanTertunggak(data)}
          daysLate={daysLate > 0 ? daysLate : null}
          awaitingTotal={awaiting.reduce((s, b) => s + b.amount, 0)}
          awaitingCount={awaiting.length}
          onTap={openBayarIuran}
        />

        <View style={{ height: 12 }} />
        <WargaHomeStatsRow
          saldoKas={data.kas.saldo}
          totalKontribusi={totalKontribusi(data)}
          paidCount={paidCount(data)}
          kasMasukBulanIni={data.kas.totalMasuk}
          isLoading={loading}
          onSaldoTap={() => navigation.navigate('WargaRiwayatTransaksi', { profile, rt })}
          onKontribusiTap={() => navigation.navigate('WargaKontribusiSaya', { profile, rt })}
        />

        <View style={{ height: 24 }} />
        <WargaSectionHeader title="Aksi cepat" showSparkle />
        <View style={{ height: 14 }} />
        <WargaAksiCepatGrid
          tagihBadgeCount={bulanTertunggak(data)}
          onTagihIuran={openBayarIuran}
          onSuratRt={() => navigation.navigate('WargaLayananSurat', { profile, rt })}
          onInfo={() => onNavigateTab(2)}
          onLayanan={() => navigation.navigate('WargaLayanan', { profile, rt })}
        />

        <View style={{ height: 12 }} />
        <WargaDaruratBanner onTap={() => navigation.navigate('WargaKontakDarurat', { profile, rt })} />

        <View style={{ height: 24 }} />
        <WargaPapanInfoHeader stripCount={strips.length} onLihatSemua={() => onNavigateTab(2)} />
        <View style={{ height: 12 }} />

        {strips.length === 0 ? (
          <Text style={styles.emptyPapan}>
            Belum ada aktivitas. Cek tab Info untuk pengumuman RT.
          </Text>
        ) : (
          strips.map((s, i) => <WargaPapanInfoStrip key={i} {...s} />)
        )}
      </ScrollView>

      {/* Detail surat dari papan info */}
      <Modal visible={detailSurat != null} transparent animationType="fade" onRequestClose={() => setDetailSurat(null)}>
        <View style={styles.dBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDetailSurat(null)} />
          <View style={styles.dDialog}>
            {detailSurat && (() => {
              const s = detailSurat;
              const st = suratStatusMeta(s);
              const item = suratItemByTypeKey(s.suratType);
              return (
                <View>
                  {/* Header */}
                  <View style={styles.dTitleRow}>
                    <Text style={styles.dDialogTitle}>Detail Permohonan</Text>
                    <Pressable onPress={() => setDetailSurat(null)} hitSlop={8} style={styles.dClose}>
                      <Icon name="close-circle-outline" size={22} color={colors.textSecondary} />
                    </Pressable>
                  </View>

                  {/* Badge + nomor */}
                  <View style={styles.dTopRow}>
                    <View style={[styles.dBadge, { backgroundColor: st.bg }]}>
                      <Text style={[styles.dBadgeText, { color: st.color }]}>{st.badge}</Text>
                    </View>
                    <Text style={styles.dNomor}>{suratReferenceCode(s, rt.rtNumber)}</Text>
                  </View>

                  {/* Kartu jenis surat */}
                  <View style={styles.dMini}>
                    <View style={styles.dIcon}>
                      <Icon name={item?.icon ?? 'document-text-outline'} size={20} color={wargaColors.primaryGreen} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.dTitle}>{s.suratType}</Text>
                      <Text style={styles.dMiniSub}>Diajukan: {formatDateShort(s.createdAt)}</Text>
                    </View>
                  </View>

                  {/* Pemohon */}
                  <View style={styles.dSectionRow}>
                    <Icon name="person-outline" size={16} color="#185FA5" />
                    <Text style={styles.dSectionTitle}>Pemohon</Text>
                  </View>
                  <View style={styles.dDataCard}>
                    <View style={styles.dGrid}>
                      <DataCell label="Nama" value={s.userName ?? profile.fullName} />
                      <DataCell label="NIK" value={s.submitterNik} />
                      <DataCell label="Pekerjaan" value={s.submitterOccupation} />
                      <DataCell label="Status" value={s.submitterMaritalStatus} />
                    </View>
                    <DataCell label="Alamat" value={s.submitterAddress ?? rt.address} full />
                  </View>

                  {/* Keperluan */}
                  <View style={styles.dSectionRow}>
                    <Icon name="document-text-outline" size={16} color="#185FA5" />
                    <Text style={styles.dSectionTitle}>Keperluan</Text>
                  </View>
                  <View style={styles.dKeperluanBox}>
                    <Text style={styles.dKeperluanText}>{s.purpose || '—'}</Text>
                  </View>

                  {/* Lihat draft surat (preview; TTD hanya muncul bila disetujui) */}
                  <Pressable
                    style={styles.dDraftBtn}
                    onPress={() => {
                      setDetailSurat(null);
                      navigation.navigate('SuratDraft', {
                        rt,
                        request: s,
                        ketuaName: data.ketua?.fullName ?? '',
                      });
                    }}
                  >
                    <Icon name="document-text-outline" size={18} color={wargaColors.primaryGreen} />
                    <Text style={styles.dDraftText}>Lihat Draft Surat</Text>
                  </Pressable>

                  {/* Status (warga: info, bukan aksi) */}
                  <View style={[styles.dStatusBox, { backgroundColor: st.bg, marginTop: 14 }]}>
                    <Icon name={st.icon} size={20} color={st.color} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={[styles.dStatusTitle, { color: st.color }]}>{st.title}</Text>
                      <Text style={styles.dStatusSub}>{st.sub}</Text>
                    </View>
                  </View>
                </View>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Detail tagihan/iuran dari papan info */}
      <Modal visible={detailBill != null} transparent animationType="fade" onRequestClose={() => setDetailBill(null)}>
        <View style={styles.dBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDetailBill(null)} />
          <View style={styles.dDialog}>
            {detailBill && (() => {
              const b = detailBill;
              const awaiting = iuranIsAwaiting(b);
              const accent = awaiting ? '#EA580C' : wargaColors.dangerRed;
              const bg = awaiting ? '#FFF3E0' : wargaColors.lightRed;
              const late = daysLateFromPeriodKey(b.periodKey);
              return (
                <View>
                  <View style={styles.dTitleRow}>
                    <Text style={styles.dDialogTitle}>Detail Iuran</Text>
                    <Pressable onPress={() => setDetailBill(null)} hitSlop={8} style={styles.dClose}>
                      <Icon name="close-circle-outline" size={22} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                  <View style={styles.dTopRow}>
                    <View style={[styles.dBadge, { backgroundColor: bg }]}>
                      <Text style={[styles.dBadgeText, { color: accent }]}>{awaiting ? 'MENUNGGU VERIFIKASI' : 'BELUM LUNAS'}</Text>
                    </View>
                  </View>
                  <View style={styles.dMini}>
                    <View style={styles.dIcon}>
                      <Icon name={awaiting ? 'time-outline' : 'card-outline'} size={20} color={accent} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.dTitle}>{iuranPeriodTitle(b)}</Text>
                      <Text style={styles.dMiniSub}>Iuran warga RT</Text>
                    </View>
                    <Text style={[styles.dAmount, { color: accent }]}>{formatRupiah(b.amount)}</Text>
                  </View>

                  <View style={styles.dSectionRow}>
                    <Icon name="information-circle-outline" size={16} color="#185FA5" />
                    <Text style={styles.dSectionTitle}>Rincian</Text>
                  </View>
                  <View style={styles.dDataCard}>
                    <View style={styles.dGrid}>
                      <DataCell label="Periode" value={iuranPeriodTitle(b)} />
                      <DataCell label="Nominal" value={formatRupiah(b.amount)} />
                      {awaiting ? (
                        <DataCell label="Metode" value={iuranPaymentMethodLabel(b)} />
                      ) : (
                        <DataCell label="Keterlambatan" value={late > 0 ? `${late} hari` : '—'} />
                      )}
                      <DataCell label="Status" value={awaiting ? 'Menunggu verifikasi' : 'Belum dibayar'} />
                    </View>
                  </View>

                  {awaiting ? (
                    <View style={[styles.dStatusBox, { backgroundColor: bg, marginTop: 14 }]}>
                      <Icon name="time-outline" size={20} color={accent} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.dStatusTitle, { color: accent }]}>Menunggu Verifikasi</Text>
                        <Text style={styles.dStatusSub}>Bukti pembayaran sedang dicek Bendahara RT.</Text>
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      style={styles.dPayBtn}
                      onPress={() => {
                        setDetailBill(null);
                        openBayarIuran();
                      }}
                    >
                      <Icon name="wallet-outline" size={18} color="#fff" />
                      <Text style={styles.dPayText}>Bayar Sekarang</Text>
                    </Pressable>
                  )}
                </View>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Detail pengumuman dari papan info (popup seragam) */}
      <AnnouncementDetailSheet announcement={detailInfo} rt={rt} onClose={() => setDetailInfo(null)} />
    </SafeAreaView>
  );

  function buildPapanStrips(): PapanStripProps[] {
    const out: PapanStripProps[] = [];

    for (const bill of awaiting) {
      out.push({
        accentColor: '#F59E0B',
        icon: 'time-outline',
        iconBg: wargaColors.accentYellow,
        iconColor: '#EA580C',
        badge: 'MENUNGGU',
        badgeBg: '#FFF3E0',
        badgeFg: '#EA580C',
        metaRight: formatDateShort(bill.submittedAt ?? new Date()),
        title: `${bill.periodLabel} — Menunggu Verifikasi`,
        subtitle: `${iuranPaymentMethodLabel(bill)} · ${formatRupiah(bill.amount)}`,
        onTap: () => setDetailBill(bill),
      });
    }

    for (const bill of unpaid.filter(billActive)) {
      out.push({
        accentColor: '#F97316',
        icon: 'card-outline',
        iconBg: wargaColors.lightRed,
        iconColor: wargaColors.dangerRed,
        badge: 'TAGIHAN',
        badgeBg: '#FFF3E0',
        badgeFg: '#EA580C',
        metaRight: formatDateShort(new Date()),
        title: `${bill.periodLabel} — Belum lunas`,
        subtitle: `Segera bayar · ${formatRupiah(bill.amount)}`,
        onTap: () => setDetailBill(bill),
      });
    }

    for (const s of data.mySuratRequests.filter(suratOnBoard)) {
      // Warna status: disetujui = hijau, ditolak = merah, menunggu = kuning.
      const statusColor = suratIsApproved(s)
        ? wargaColors.primaryGreen
        : suratIsRejected(s)
          ? wargaColors.dangerRed
          : '#D97706';
      out.push({
        accentColor: statusColor,
        icon: 'home-outline',
        iconBg: wargaColors.accentBlue,
        iconColor: '#185FA5',
        badge: 'SURAT',
        badgeBg: wargaColors.lightGreen,
        badgeFg: wargaColors.primaryGreen,
        metaRight: suratStatusLabel(s),
        metaRightColor: statusColor,
        title: s.suratType,
        subtitle: s.purpose.length > 0 ? s.purpose : 'Menunggu persetujuan RT',
        onTap: () => setDetailSurat(s),
      });
    }

    for (const a of data.announcements.filter(announcementActive)) {
      out.push({
        accentColor: '#185FA5',
        icon: 'megaphone-outline',
        iconBg: wargaColors.accentBlue,
        iconColor: '#185FA5',
        badge: a.isPinned ? 'PENTING' : 'INFO',
        badgeBg: a.isPinned ? wargaColors.accentYellow : wargaColors.lightGreen,
        badgeFg: a.isPinned ? '#BA7517' : wargaColors.primaryGreen,
        metaRight: formatDateShort(a.createdAt),
        title: a.title,
        subtitle: a.content.length > 48 ? `${a.content.slice(0, 48)}…` : a.content,
        onTap: () => setDetailInfo(a),
      });
    }

    return out;
  }
}

function maxDaysLate(unpaid: { periodKey: string }[]): number {
  let max = 0;
  for (const r of unpaid) {
    const d = daysLateFromPeriodKey(r.periodKey);
    if (d > max) max = d;
  }
  return max;
}

function suratStatusMeta(s: SuratRequest): {
  badge: string; title: string; sub: string; icon: string; color: string; bg: string;
} {
  if (suratIsApproved(s))
    return { badge: 'DISETUJUI', title: 'Surat Disetujui', sub: 'Telah disetujui pengurus RT.', icon: 'checkmark-circle', color: wargaColors.primaryGreen, bg: wargaColors.lightGreen };
  if (suratIsRejected(s))
    return { badge: 'DITOLAK', title: 'Surat Ditolak', sub: 'Tidak disetujui pengurus RT.', icon: 'close-circle-outline', color: wargaColors.dangerRed, bg: wargaColors.lightRed };
  return { badge: 'MENUNGGU', title: 'Menunggu Persetujuan', sub: 'Sedang diproses pengurus RT.', icon: 'time-outline', color: '#D97706', bg: '#FEF3C7' };
}

function DataCell({ label, value, full }: { label: string; value?: string | null; full?: boolean }) {
  return (
    <View style={{ width: full ? '100%' : '50%', marginBottom: full ? 0 : 8 }}>
      <Text style={styles.dCellLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.dCellValue}>{value && value.trim() !== '' ? value : '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: wargaColors.bgColor },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
  emptyPapan: { color: colors.textSecondary, fontSize: 13, paddingVertical: 12 },
  dBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  dDialog: { width: '100%', maxWidth: 400, backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
  dTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  dDialogTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  dTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  dMini: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background, borderRadius: 14, padding: 10 },
  dMiniSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  dIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: wargaColors.lightGreen, alignItems: 'center', justifyContent: 'center' },
  dTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  dBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  dBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
  dNomor: { fontSize: 11, color: colors.textSecondary },
  dClose: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  dStatusBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, marginBottom: 4 },
  dStatusTitle: { fontSize: 14, fontWeight: '700' },
  dStatusSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  dSectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 6 },
  dSectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  dDataCard: { backgroundColor: colors.background, borderRadius: 14, padding: 12 },
  dName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  dNameSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2, marginBottom: 8 },
  dGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dCellLabel: { fontSize: 10, fontWeight: '600', color: colors.textHint, letterSpacing: 0.3 },
  dCellValue: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginTop: 2 },
  dKeperluanBox: { backgroundColor: colors.background, borderRadius: 14, padding: 12 },
  dDraftBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: wargaColors.primaryGreen, marginTop: 12 },
  dDraftText: { color: wargaColors.primaryGreen, fontWeight: '700', fontSize: 14 },
  dAmount: { fontSize: 16, fontWeight: '800' },
  dPayBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 12, backgroundColor: wargaColors.primaryGreen, marginTop: 16 },
  dPayText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  dInfoBody: { fontSize: 14, color: colors.textPrimary, lineHeight: 21 },
  dKeperluanText: { fontSize: 13, color: colors.textPrimary },
  dTanggalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  dTanggalLabel: { fontSize: 13, color: colors.textSecondary },
  dTanggalValue: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
});
