// Port dari lib/pages/warga/warga_info_view.dart
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../../components/Icon';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, wargaColors } from '../../config/theme';
import { WargaCard, wargaText } from '../../components/warga/wargaUi';
import { WargaInfoAnnouncementCard, WargaInfoHeroCard } from '../../components/warga/InfoWidgets';
import { rtService } from '../../services/rtService';
import { announcementReadService } from '../../services/announcementReadService';
import { categoryKindFor } from '../../lib/announcementCategory';
import { announcementActive, groupByYearMonth } from '../../lib/papanInfo';
import { Announcement } from '../../types/models';
import { AnnouncementDetailSheet } from '../../components/warga/AnnouncementDetailSheet';
import { Profile, RtUnit } from '../../types/models';
import type { RootStackParamList } from '../../navigation/types';

interface Props {
  profile: Profile;
  rt: RtUnit;
  onAnnouncementRead?: () => void;
}

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// Kelompokkan pengumuman expired: Tahun -> Bulan (terbaru dahulu).
function buildYears(items: Announcement[]) {
  const months = groupByYearMonth(items, (a) => a.eventDate ?? a.createdAt);
  const years: { year: number; count: number; months: typeof months }[] = [];
  for (const mg of months) {
    let y = years.find((x) => x.year === mg.year);
    if (!y) {
      y = { year: mg.year, count: 0, months: [] };
      years.push(y);
    }
    y.months.push(mg);
    y.count += mg.items.length;
  }
  return years;
}

export function WargaInfoScreen({ profile, rt, onAnnouncementRead }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<Announcement[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState(0);
  const [detail, setDetail] = useState<Announcement | null>(null);
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());

  const toggleSet = <T,>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, key: T) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const load = useCallback(async () => {
    try {
      const list = await rtService.getAnnouncements(rt.id);
      const reads = await announcementReadService.readIdsForRt(rt.id);
      const unread = await announcementReadService.unreadCount(rt.id, list);
      setItems(list);
      setReadIds(reads);
      setUnreadCount(unread);
    } catch {
      // biarkan data lama
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [rt.id]);

  useEffect(() => {
    load();
  }, [load]);

  const countByKind = (kind: 'kerjaBakti' | 'info' | 'darurat') =>
    items.filter((a) => categoryKindFor(a) === kind).length;

  const openAnnouncement = async (a: Announcement) => {
    setDetail(a);
    await announcementReadService.markRead(rt.id, a.id);
    onAnnouncementRead?.();
    load();
  };

  // Urutkan murni terbaru di atas (abaikan pin untuk urutan).
  const active = items
    .filter(announcementActive)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const expired = items.filter((a) => !announcementActive(a));

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Text style={styles.header}>Informasi</Text>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.emerald}
          />
        }
      >
        <WargaInfoHeroCard
          activeCount={active.length}
          unreadCount={unreadCount}
          infoCount={countByKind('info')}
          kerjaBaktiCount={countByKind('kerjaBakti')}
          daruratCount={countByKind('darurat')}
        />
        <View style={{ height: 16 }} />

        {/* Segment: Aktif / Riwayat */}
        <View style={styles.segment}>
          <Pressable style={[styles.segTab, tab === 0 && styles.segTabActive]} onPress={() => setTab(0)}>
            <Icon name="megaphone-outline" size={15} color={tab === 0 ? wargaColors.primaryGreen : colors.textSecondary} />
            <Text style={[styles.segText, tab === 0 && styles.segTextActive]}>Informasi Aktif</Text>
            {active.length > 0 && <View style={styles.segBadge}><Text style={styles.segBadgeText}>{active.length}</Text></View>}
          </Pressable>
          <Pressable style={[styles.segTab, tab === 1 && styles.segTabActive]} onPress={() => setTab(1)}>
            <Icon name="time-outline" size={15} color={tab === 1 ? wargaColors.primaryGreen : colors.textSecondary} />
            <Text style={[styles.segText, tab === 1 && styles.segTextActive]} numberOfLines={1}>Riwayat Informasi</Text>
            {expired.length > 0 && <View style={styles.segBadge}><Text style={styles.segBadgeText}>{expired.length}</Text></View>}
          </Pressable>
        </View>
        <View style={{ height: 16 }} />

        {loading ? null : tab === 0 ? (
          active.length === 0 ? (
            <EmptyInfo message="Belum ada informasi aktif dari pengurus RT." />
          ) : (
            active.map((a) => (
              <WargaInfoAnnouncementCard key={a.id} item={a} isUnread={!readIds.has(a.id)} onTap={() => openAnnouncement(a)} />
            ))
          )
        ) : expired.length === 0 ? (
          <EmptyInfo message="Belum ada riwayat informasi." />
        ) : (
          buildYears(expired).map((y) => {
            const yOpen = !collapsedYears.has(y.year);
            return (
              <View key={y.year} style={{ marginBottom: 10 }}>
                <Pressable style={styles.yearHeader} onPress={() => toggleSet(setCollapsedYears, y.year)}>
                  <Icon name={yOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
                  <Text style={styles.yearText}>{y.year}</Text>
                  <View style={styles.countBadge}><Text style={styles.countBadgeText}>{y.count}</Text></View>
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
                          <View style={styles.countBadge}><Text style={styles.countBadgeText}>{mg.items.length}</Text></View>
                        </Pressable>
                        {mOpen &&
                          mg.items.map((a) => (
                            <WargaInfoAnnouncementCard key={a.id} item={a} isUnread={!readIds.has(a.id)} onTap={() => openAnnouncement(a)} />
                          ))}
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

function EmptyInfo({ message }: { message: string }) {
  return (
    <WargaCard>
      <View style={{ alignItems: 'center' }}>
        <Icon name="megaphone-outline" size={48} color={colors.textSecondary} />
        <Text style={[wargaText.greeting, { marginTop: 12, textAlign: 'center' }]}>{message}</Text>
      </View>
    </WargaCard>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: wargaColors.bgColor },
  header: { textAlign: 'center', fontSize: 17, fontWeight: '600', color: colors.textPrimary, paddingTop: 8, paddingBottom: 10 },
  scroll: { paddingHorizontal: 20, paddingBottom: 96 },
  segment: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 4, gap: 4 },
  segTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  segTabActive: { backgroundColor: wargaColors.lightGreen },
  segText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  segTextActive: { color: wargaColors.primaryGreen },
  segBadge: { backgroundColor: '#FEF3C7', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  segBadgeText: { fontSize: 10, fontWeight: '700', color: '#92400E' },
  yearHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  yearText: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  tutupText: { fontSize: 12, color: colors.textSecondary },
  countBadge: { backgroundColor: wargaColors.lightGreen, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  countBadgeText: { fontSize: 11, fontWeight: '600', color: wargaColors.primaryGreen },
  monthBlock: { marginLeft: 4 },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  monthName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
});
