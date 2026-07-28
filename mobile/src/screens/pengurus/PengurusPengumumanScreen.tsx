// Port dari lib/pages/tabs/pengumuman_tab.dart
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../../components/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, wargaColors } from '../../config/theme';
import { WargaCard, wargaText } from '../../components/warga/wargaUi';
import { WargaPageHeader } from '../../components/warga/DashboardWidgets';
import { WargaEmptyState, WargaPengumumanFeedCard } from '../../components/warga/PengurusWidgets';
import { announcementReadService } from '../../services/announcementReadService';
import { AnnouncementDetailSheet } from '../../components/warga/AnnouncementDetailSheet';
import { rtService } from '../../services/rtService';
import { useToast } from '../../components/Toast';
import { confirmDialog } from '../../lib/dialog';
import { announcementActive, groupByYearMonth } from '../../lib/papanInfo';
import { Announcement, Profile, RtUnit, profileIsBendahara, profileIsKetua, rtDisplayLabel } from '../../types/models';
import type { RootStackParamList } from '../../navigation/types';

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// Kelompokkan pengumuman expired: Tahun -> Bulan (terbaru dulu).
function buildYears(items: Announcement[]) {
  const months = groupByYearMonth(items, (a) => a.eventDate ?? a.createdAt);
  const years: { year: number; count: number; months: typeof months }[] = [];
  for (const mg of months) {
    let y = years.find((x) => x.year === mg.year);
    if (!y) { y = { year: mg.year, count: 0, months: [] }; years.push(y); }
    y.months.push(mg);
    y.count += mg.items.length;
  }
  return years;
}

interface Props {
  profile: Profile;
  rt: RtUnit;
  onChanged: () => void;
  onBack?: () => void;
}

export function PengurusPengumumanScreen({ profile, rt, onChanged, onBack }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const toast = useToast();
  const [items, setItems] = useState<Announcement[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState(0);
  const [detail, setDetail] = useState<Announcement | null>(null);
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const canPost = profileIsKetua(profile) || profileIsBendahara(profile);
  const brand = profileIsKetua(profile) ? wargaColors.primaryGreen : '#EA580C';
  const brandSoft = profileIsKetua(profile) ? wargaColors.lightGreen : '#FFEDD5';

  const toggleSet = <T,>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, key: T) =>
    setter((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const load = useCallback(async () => {
    const list = await rtService.getAnnouncements(rt.id);
    setItems(list);
    setUnread(await announcementReadService.unreadCount(rt.id, list));
    setLoading(false);
    setRefreshing(false);
  }, [rt.id]);

  useEffect(() => {
    load();
  }, [load]);

  const openItem = async (a: Announcement) => {
    setDetail(a);
    // Tandai dibaca + refresh badge lokal saja. JANGAN onChanged() (memicu
    // reload global yang me-remount shell → lompat ke Beranda).
    await announcementReadService.markRead(rt.id, a.id);
    load();
  };

  const reloadAll = () => {
    load();
    onChanged();
  };

  const openCreate = () =>
    navigation.navigate('CreateAnnouncement', { rtId: rt.id, onCreated: reloadAll });

  const openEdit = (a: Announcement) =>
    navigation.navigate('CreateAnnouncement', { rtId: rt.id, editing: a, onCreated: reloadAll });

  const removeItem = (a: Announcement) =>
    confirmDialog(
      'Hapus pengumuman?',
      `"${a.title}" akan dihapus permanen dan hilang dari papan info warga.`,
      async () => {
        try {
          await rtService.deleteAnnouncement(a.id);
          toast.success('Pengumuman dihapus');
          reloadAll();
        } catch (e: any) {
          toast.error(String(e?.message ?? e));
        }
      },
      'Hapus',
    );

  const renderCard = (a: Announcement) => (
    <View key={a.id}>
      <WargaPengumumanFeedCard item={a} onTap={() => openItem(a)} />
      {canPost && (
        <View style={styles.actionRow}>
          <Pressable style={styles.actionBtn} onPress={() => openEdit(a)}>
            <Icon name="create-outline" size={16} color={brand} />
            <Text style={[styles.actionText, { color: brand }]}>Edit</Text>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => removeItem(a)}>
            <Icon name="trash-outline" size={16} color={wargaColors.dangerRed} />
            <Text style={[styles.actionText, { color: wargaColors.dangerRed }]}>Hapus</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  const active = items.filter(announcementActive).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const expired = items.filter((a) => !announcementActive(a));

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.emerald} />}
      >
        {onBack && (
          <Pressable onPress={onBack} style={styles.backRow}>
            <Icon name="chevron-back" size={18} color={brand} />
            <Text style={[styles.backRowText, { color: brand }]}>Kembali ke Beranda</Text>
          </Pressable>
        )}
        <WargaPageHeader
          title="Pengumuman RT"
          subtitle={`Informasi untuk ${rtDisplayLabel(rt)}`}
          trailing={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {unread > 0 && (
                <View style={[styles.countBadge, { backgroundColor: brandSoft }]}>
                  <Text style={[styles.countBadgeText, { color: brand }]}>{unread}</Text>
                </View>
              )}
              {canPost && (
                <Pressable onPress={openCreate} style={[styles.addBtn, { backgroundColor: brandSoft }]}>
                  <Icon name="add" size={22} color={brand} />
                </Pressable>
              )}
            </View>
          }
        />
        <View style={{ height: 20 }} />

        {!canPost && (
          <WargaCard style={{ marginBottom: 12 }}>
            <Text style={wargaText.greeting}>Pengumuman dari Ketua RT / Bendahara akan muncul di sini.</Text>
          </WargaCard>
        )}

        {/* Segment: Aktif / Riwayat */}
        <View style={styles.segment}>
          <Pressable style={[styles.segTab, tab === 0 && styles.segTabActive, tab === 0 && { backgroundColor: brandSoft }]} onPress={() => setTab(0)}>
            <Icon name="megaphone-outline" size={15} color={tab === 0 ? brand : colors.textSecondary} />
            <Text style={[styles.segText, tab === 0 && { color: brand }]}>Informasi Aktif</Text>
            {active.length > 0 && <View style={styles.segBadge}><Text style={styles.segBadgeText}>{active.length}</Text></View>}
          </Pressable>
          <Pressable style={[styles.segTab, tab === 1 && styles.segTabActive, tab === 1 && { backgroundColor: brandSoft }]} onPress={() => setTab(1)}>
            <Icon name="time-outline" size={15} color={tab === 1 ? brand : colors.textSecondary} />
            <Text style={[styles.segText, tab === 1 && { color: brand }]} numberOfLines={1}>Riwayat Informasi</Text>
            {expired.length > 0 && <View style={styles.segBadge}><Text style={styles.segBadgeText}>{expired.length}</Text></View>}
          </Pressable>
        </View>
        <View style={{ height: 16 }} />

        {loading ? null : tab === 0 ? (
          active.length === 0 ? (
            <WargaEmptyState icon="megaphone-outline" message={canPost ? 'Belum ada informasi aktif.\nBuat lewat tombol +' : 'Belum ada informasi aktif dari pengurus RT.'} />
          ) : (
            active.map(renderCard)
          )
        ) : expired.length === 0 ? (
          <WargaEmptyState icon="time-outline" message={'Belum ada riwayat informasi.'} />
        ) : (
          buildYears(expired).map((y) => {
            const yOpen = !collapsedYears.has(y.year);
            return (
              <View key={y.year} style={{ marginBottom: 10 }}>
                <Pressable style={styles.yearHeader} onPress={() => toggleSet(setCollapsedYears, y.year)}>
                  <Icon name={yOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
                  <Text style={styles.yearText}>{y.year}</Text>
                  <View style={[styles.miniBadge, { backgroundColor: brandSoft }]}><Text style={[styles.countBadgeText, { color: brand }]}>{y.count}</Text></View>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.tutupText}>{yOpen ? 'Tutup' : 'Lihat'}</Text>
                </Pressable>
                {yOpen &&
                  y.months.map((mg) => {
                    const mOpen = openMonths.has(mg.key);
                    return (
                      <View key={mg.key} style={styles.monthBlock}>
                        <Pressable style={styles.monthRow} onPress={() => toggleSet(setOpenMonths, mg.key)}>
                          <Icon name={mOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textSecondary} />
                          <Text style={styles.monthName}>{BULAN[mg.month - 1]}</Text>
                          <View style={[styles.miniBadge, { backgroundColor: brandSoft }]}><Text style={[styles.countBadgeText, { color: brand }]}>{mg.items.length}</Text></View>
                        </Pressable>
                        {mOpen && mg.items.map(renderCard)}
                      </View>
                    );
                  })}
              </View>
            );
          })
        )}
      </ScrollView>
      <AnnouncementDetailSheet announcement={detail} rt={rt} onClose={() => setDetail(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: wargaColors.bgColor },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 100 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  backRowText: { fontWeight: '600' },
  countBadge: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: wargaColors.lightGreen, borderRadius: 20 },
  countBadgeText: { fontSize: 13, fontWeight: '600', color: wargaColors.primaryGreen },
  addBtn: { padding: 10, backgroundColor: wargaColors.lightGreen, borderRadius: 12 },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: -6, marginBottom: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  actionText: { fontSize: 12, fontWeight: '600', color: wargaColors.primaryGreen },
  segment: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 4, gap: 4 },
  segTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  segTabActive: { backgroundColor: wargaColors.lightGreen },
  segText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  segTextActive: { color: wargaColors.primaryGreen },
  segBadge: { backgroundColor: '#FEF3C7', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  segBadgeText: { fontSize: 10, fontWeight: '700', color: '#92400E' },
  yearHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  yearText: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  tutupText: { fontSize: 12, color: colors.textSecondary },
  miniBadge: { backgroundColor: wargaColors.lightGreen, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  monthBlock: { marginLeft: 4 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  monthName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
});
