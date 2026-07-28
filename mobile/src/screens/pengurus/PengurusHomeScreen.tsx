// Beranda pengurus (Ketua RT / Bendahara).
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../../components/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, formatRupiah, wargaColors } from '../../config/theme';
import { WargaBerandaHeader, WargaSectionHeader } from '../../components/warga/BerandaWidgets';
import { WargaEmptyState, WargaPengumumanFeedCard } from '../../components/warga/PengurusWidgets';
import { useToast } from '../../components/Toast';
import { announcementReadService } from '../../services/announcementReadService';
import { rtService } from '../../services/rtService';
import { familyService } from '../../services/familyService';
import {
  Announcement,
  KasSummary,
  Profile,
  RtUnit,
  SuratRequest,
  emptyKasSummary,
  iuranIsAwaiting,
  iuranIsPaid,
  profileIsKetua,
  rtDisplayLabel,
  suratIsPending,
} from '../../types/models';
import { announcementActive, currentPeriodKey } from '../../lib/papanInfo';
import { greetingByTime, honorificName, formatDateShort } from '../../lib/date';
import type { RootStackParamList } from '../../navigation/types';
import type { OfficerTabNav } from './PengurusMainShell';

interface Props {
  profile: Profile;
  rt: RtUnit;
  onNavigateTab: OfficerTabNav;
}

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function PengurusHomeScreen({ profile, rt, onNavigateTab }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const toast = useToast();
  const [kas, setKas] = useState<KasSummary>(emptyKasSummary());
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [belumBayar, setBelumBayar] = useState(0);
  const [menungguVerifikasi, setMenungguVerifikasi] = useState(0);
  const [paidRate, setPaidRate] = useState(0);
  const [suratPending, setSuratPending] = useState(0);
  const [pendingSurat, setPendingSurat] = useState<SuratRequest[]>([]);
  const [jiwaExtra, setJiwaExtra] = useState(0);
  const [unread, setUnread] = useState(0);
  const [pendingWarga, setPendingWarga] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const isKetua = profileIsKetua(profile);

  const now = new Date();
  const monthLabel = `${BULAN[now.getMonth()]} ${now.getFullYear()}`;
  const kkCount = rt.memberCount;
  const jiwaCount = kkCount + jiwaExtra;
  const pengeluaranPct = kas.totalMasuk > 0 ? Math.round((kas.totalKeluar / kas.totalMasuk) * 100) : 0;

  const load = useCallback(async () => {
    const [k, ann, bills, fc] = await Promise.all([
      rtService.getKasSummary(rt.id),
      rtService.getAnnouncements(rt.id),
      rtService.getIuranRecords(rt.id),
      familyService.countInRt(rt.id).catch(() => 0),
    ]);
    setKas(k);
    setAnnouncements(ann);
    setJiwaExtra(fc);
    setBelumBayar(bills.filter((b) => !iuranIsPaid(b)).length);
    setMenungguVerifikasi(bills.filter(iuranIsAwaiting).length);
    const cur = bills.filter((b) => b.periodKey === currentPeriodKey());
    const paidCur = cur.filter(iuranIsPaid).length;
    setPaidRate(cur.length > 0 ? Math.round((paidCur / cur.length) * 100) : 0);
    if (isKetua) {
      const surat = await rtService.getSuratRequests(rt.id, true);
      const pend = surat.filter(suratIsPending);
      setSuratPending(pend.length);
      setPendingSurat(pend);
    }
    setUnread(await announcementReadService.unreadCount(rt.id, ann));
    setPendingWarga(await rtService.countPendingWarga(rt.id).catch(() => 0));
    setRefreshing(false);
  }, [rt.id, isKetua]);

  // Muat ulang tiap Beranda kembali fokus agar surat/pengumuman baru cepat tampil.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openAnnouncement = async (a: Announcement) => {
    await announcementReadService.markRead(rt.id, a.id);
    setUnread(await announcementReadService.unreadCount(rt.id, announcements));
    navigation.navigate('AnnouncementDetail', { announcement: a });
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.emerald} />}
      >
        <WargaBerandaHeader
          greetingLine={`${greetingByTime()}, ${isKetua ? honorificName(profile.fullName) : profile.fullName}`}
          fullName={isKetua ? honorificName(profile.fullName) : profile.fullName}
          roleRtLine={`${isKetua ? 'Ketua RT' : 'Bendahara'} • ${rtDisplayLabel(rt)}`}
          avatarUrl={profile.avatarUrl}
          notifCount={isKetua ? pendingWarga : menungguVerifikasi}
          onNotifTap={() =>
            isKetua
              ? navigation.navigate('DataWarga', { profile, rt })
              : onNavigateTab(1, 'verifikasi')
          }
        />
        <View style={{ height: 16 }} />

        {/* Saldo Kas RT (Bendahara → oranye) */}
        <Pressable style={[styles.saldoCard, !isKetua && styles.saldoCardBendahara]} onPress={() => onNavigateTab(2)}>
          <View style={{ flex: 1 }}>
            <View style={styles.saldoLabelRow}>
              <Icon name="wallet-outline" size={14} color="rgba(255,255,255,0.9)" />
              <Text style={styles.saldoLabel}>SALDO KAS RT</Text>
            </View>
            <Text style={styles.saldoValue}>{formatRupiah(kas.saldo)}</Text>
            <Text style={styles.saldoMonth}>{monthLabel}</Text>
          </View>
          <View style={styles.saldoArrow}>
            <Icon name="chevron-forward" size={20} color="#fff" />
          </View>
        </Pressable>

        {/* Stat: Total KK/Jiwa + Pengeluaran */}
        <View style={styles.statRow}>
          <View style={[styles.statTile, { backgroundColor: '#FEF9C3' }]}>
            <View style={[styles.statIcon, { backgroundColor: '#FDE68A' }]}>
              <Icon name="people" size={16} color="#B45309" />
            </View>
            <Text style={styles.statValue}>{kkCount} / {jiwaCount}</Text>
            <Text style={styles.statLabel}>TOTAL KK / JIWA</Text>
          </View>
          <View style={[styles.statTile, { backgroundColor: '#FEE2E2' }]}>
            <View style={styles.statTopRow}>
              <View style={[styles.statIcon, { backgroundColor: '#FECACA' }]}>
                <Icon name="arrow-down-outline" size={16} color={wargaColors.dangerRed} />
              </View>
              <View style={styles.pctBadge}><Text style={styles.pctText}>{pengeluaranPct}%</Text></View>
            </View>
            <Text style={styles.statValue}>{formatRupiah(kas.totalKeluar)}</Text>
            <Text style={styles.statLabel}>PENGELUARAN</Text>
          </View>
        </View>

        {/* Aksi Cepat */}
        <View style={{ height: 22 }} />
        <WargaSectionHeader title="Aksi Cepat" showSparkle />
        <View style={{ height: 12 }} />
        <View style={styles.quickRow}>
          {isKetua ? (
            <QuickTile icon="document-text" color="#2563EB" label={'Verifikasi\nSurat'} badge={suratPending} onPress={() => navigation.navigate('SuratPengantar', { profile, rt })} />
          ) : (
            <QuickTile icon="document-text" color="#2563EB" label={'Laporan\nKas'} onPress={() => navigation.navigate('LaporanBulanan', { profile, rt })} />
          )}
          <QuickTile icon="megaphone" color="#EA580C" label="Info" badge={unread} onPress={() => onNavigateTab(3)} />
          <QuickTile icon="card" color={wargaColors.primaryGreen} label={'Tagih\nIuran'} badge={belumBayar} onPress={() => onNavigateTab(1, 'tagih')} />
          <QuickTile icon="shield" color="#7C3AED" label={'Jadwal\nRonda'} onPress={() => navigation.navigate('JadwalRonda', { profile, rt })} />
          <QuickTile icon="call" color="#DC2626" label="Layanan" onPress={() => navigation.navigate('WargaLayanan', { profile, rt })} />
        </View>

        {menungguVerifikasi > 0 && (
          <Pressable style={styles.verifBanner} onPress={() => onNavigateTab(1, 'verifikasi')}>
            <View style={styles.verifIcon}>
              <Icon name="time-outline" size={20} color="#B45309" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.verifTitle}>{menungguVerifikasi} pembayaran menunggu verifikasi</Text>
              <Text style={styles.verifSub}>Ketuk untuk memeriksa & menyetujui bukti bayar warga.</Text>
            </View>
            <Icon name="chevron-forward" size={18} color="#B45309" />
          </Pressable>
        )}

        {/* Statistik Iuran */}
        <View style={{ height: 22 }} />
        <View style={styles.iuranCard}>
          <View style={styles.iuranHead}>
            <Text style={styles.iuranTitle}>Statistik Iuran</Text>
            <View style={styles.monthBadge}><Text style={styles.monthBadgeText}>{monthLabel}</Text></View>
          </View>
          <View style={styles.iuranRateRow}>
            <Text style={styles.iuranRateLabel}>Tingkat Pembayaran</Text>
            <Text style={styles.iuranRateValue}>{paidRate}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${paidRate}%` }]} />
          </View>
          <View style={styles.iuranSubRow}>
            <View style={[styles.iuranSub, { backgroundColor: wargaColors.lightGreen }]}>
              <Text style={styles.iuranSubLabel}>↗ Pemasukan</Text>
              <Text style={[styles.iuranSubValue, { color: wargaColors.primaryGreen }]}>{formatRupiah(kas.totalMasuk)}</Text>
            </View>
            <View style={[styles.iuranSub, { backgroundColor: '#FEF2F2' }]}>
              <Text style={styles.iuranSubLabel}>↘ Pengeluaran</Text>
              <Text style={[styles.iuranSubValue, { color: wargaColors.dangerRed }]}>{formatRupiah(kas.totalKeluar)}</Text>
            </View>
          </View>
        </View>

        {/* Papan Info */}
        <View style={{ height: 22 }} />
        <WargaSectionHeader
          title="Papan Info"
          trailing="Lihat Semua >"
          onTrailingTap={() => onNavigateTab(3)}
        />
        <View style={{ height: 10 }} />
        {pendingSurat.map((s) => (
          <SuratMenungguCard
            key={s.id}
            surat={s}
            onTap={() => navigation.navigate('SuratPengantar', { profile, rt })}
          />
        ))}
        {(() => {
          const aktif = announcements.filter(announcementActive);
          if (aktif.length === 0 && pendingSurat.length === 0) {
            return <WargaEmptyState icon="megaphone-outline" message="Belum ada informasi aktif. Yang tanggalnya lewat pindah ke Riwayat." />;
          }
          return aktif.slice(0, 3).map((a) => (
            <WargaPengumumanFeedCard key={a.id} item={a} onTap={() => openAnnouncement(a)} />
          ));
        })()}
      </ScrollView>
    </SafeAreaView>
  );
}

// Kartu surat menunggu persetujuan di Papan Info Ketua.
function SuratMenungguCard({ surat, onTap }: { surat: SuratRequest; onTap: () => void }) {
  return (
    <Pressable style={styles.suratCard} onPress={onTap}>
      <View style={styles.suratIcon}>
        <Icon name="document-text" size={18} color="#B45309" />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={styles.suratTopRow}>
          <View style={styles.suratBadge}>
            <Text style={styles.suratBadgeText}>MENUNGGU</Text>
          </View>
          <Text style={styles.suratDate}>{formatDateShort(surat.createdAt)}</Text>
        </View>
        <Text style={styles.suratTitle} numberOfLines={1}>{surat.suratType}</Text>
        <Text style={styles.suratSub} numberOfLines={1}>
          {surat.userName ?? 'Warga'} · Menunggu persetujuan
        </Text>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

function QuickTile({
  icon, color, label, badge, onPress,
}: { icon: IconName; color: string; label: string; badge?: number; onPress: () => void }) {
  return (
    <Pressable style={styles.qTile} onPress={onPress}>
      <View style={[styles.qIcon, { backgroundColor: color }]}>
        <Icon name={icon} size={24} color="#fff" strokeWidth={2.2} />
        {badge != null && badge > 0 && (
          <View style={styles.qBadge}>
            <Text style={styles.qBadgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.qLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: wargaColors.bgColor },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 100 },
  saldoCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: wargaColors.primaryGreen, borderRadius: 18, padding: 18,
  },
  saldoCardBendahara: { backgroundColor: '#EA580C' },
  saldoLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  saldoLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.9)', letterSpacing: 0.5 },
  saldoValue: { fontSize: 28, fontWeight: '800', color: '#fff', marginTop: 6 },
  saldoMonth: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  saldoArrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  statRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  statTile: { flex: 1, borderRadius: 16, padding: 14 },
  statTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginTop: 10 },
  statLabel: { fontSize: 10, fontWeight: '600', color: colors.textSecondary, marginTop: 2, letterSpacing: 0.3 },
  pctBadge: { backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  pctText: { fontSize: 10, fontWeight: '700', color: wargaColors.dangerRed },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between' },
  qTile: { width: '18.5%', alignItems: 'center' },
  qIcon: { width: '100%', aspectRatio: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  qBadge: { position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: wargaColors.dangerRed, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: wargaColors.bgColor },
  qBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  qLabel: { fontSize: 10, fontWeight: '600', color: colors.textPrimary, marginTop: 6, textAlign: 'center' },
  verifBanner: { flexDirection: 'row', alignItems: 'center', marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' },
  verifIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' },
  verifTitle: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  verifSub: { fontSize: 12, color: '#B45309', marginTop: 2 },
  iuranCard: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16 },
  iuranHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  iuranTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  monthBadge: { backgroundColor: wargaColors.lightGreen, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  monthBadgeText: { fontSize: 11, fontWeight: '600', color: wargaColors.primaryGreen },
  iuranRateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  iuranRateLabel: { fontSize: 13, color: colors.textSecondary },
  iuranRateValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.background, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: wargaColors.primaryGreen },
  iuranSubRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  iuranSub: { flex: 1, borderRadius: 12, padding: 12 },
  iuranSubLabel: { fontSize: 12, color: colors.textSecondary },
  iuranSubValue: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  suratCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderWidth: 1, borderColor: '#FDE68A', borderRadius: 14, padding: 12, marginBottom: 10,
  },
  suratIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' },
  suratTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  suratBadge: { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#FEF3C7', borderRadius: 6 },
  suratBadgeText: { fontSize: 9, fontWeight: '700', color: '#B45309', letterSpacing: 0.3 },
  suratDate: { fontSize: 11, color: colors.textSecondary },
  suratTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  suratSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
});
