// Detail pengumuman sebagai bottom-sheet popup (bukan halaman terpisah).
import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icon';
import { colors, wargaColors } from '../../config/theme';
import { Announcement, RtUnit, announcementCreatedLabel, announcementHasImage, rtDisplayLabel } from '../../types/models';
import { categoryMetaFor } from '../../lib/announcementCategory';
import { formatDate } from '../../lib/date';

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'baru saja';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const hari = Math.floor(h / 24);
  if (hari < 30) return `${hari} hari lalu`;
  const bln = Math.floor(hari / 30);
  if (bln < 12) return `${bln} bulan lalu`;
  return `${Math.floor(bln / 12)} tahun lalu`;
}

export function AnnouncementDetailSheet({
  announcement,
  rt,
  onClose,
}: {
  announcement: Announcement | null;
  rt: RtUnit;
  onClose: () => void;
}) {
  const a = announcement;
  const meta = a ? categoryMetaFor(a) : null;
  return (
    <Modal visible={!!a} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {a && meta && (
            <View>
              <View style={styles.head}>
                <View style={[styles.badgeIcon, { backgroundColor: meta.bg }]}>
                  <Icon name={meta.icon} size={18} color={meta.color} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                      <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                    <Text style={styles.date}>{announcementCreatedLabel(a)}</Text>
                  </View>
                  <Text style={styles.title}>{a.title}</Text>
                </View>
                <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
                  <Icon name="close" size={20} color={colors.textSecondary} />
                </Pressable>
              </View>

              {announcementHasImage(a) && (
                <Image source={{ uri: a.imageUrl! }} style={styles.image} resizeMode="cover" />
              )}

              <View style={styles.contentBox}>
                <Text style={styles.content}>{a.content}</Text>
              </View>

              <View style={styles.authorRow}>
                <View style={[styles.authorIcon, { backgroundColor: meta.color }]}>
                  <Icon name="shield" size={16} color="#fff" />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.authorName}>{a.authorName ?? 'Pengurus RT'}</Text>
                  <Text style={styles.authorSub}>{rtDisplayLabel(rt)}</Text>
                </View>
                <View style={styles.timeRow}>
                  <Icon name="time-outline" size={13} color={colors.textHint} />
                  <Text style={styles.timeText}>{timeAgo(a.createdAt)}</Text>
                </View>
              </View>

              {a.eventDate && (
                <View style={styles.eventRow}>
                  <Icon name="calendar-outline" size={16} color={colors.textSecondary} />
                  <View style={{ marginLeft: 10 }}>
                    <Text style={styles.eventLabel}>Berlaku hingga</Text>
                    <Text style={styles.eventDate}>{formatDate(a.eventDate)}</Text>
                  </View>
                </View>
              )}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 460, backgroundColor: colors.surface, borderRadius: 20, padding: 18 },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  badgeIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  date: { fontSize: 11, color: colors.textHint },
  title: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginTop: 6 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  image: { width: '100%', aspectRatio: 16 / 10, borderRadius: 14, marginTop: 14, backgroundColor: colors.emeraldSoft },
  contentBox: { backgroundColor: colors.background, borderRadius: 14, padding: 14, marginTop: 14 },
  content: { fontSize: 14, lineHeight: 22, color: colors.textPrimary },
  authorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  authorIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  authorName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  authorSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeText: { fontSize: 11, color: colors.textHint },
  eventRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background, borderRadius: 12, padding: 12, marginTop: 12 },
  eventLabel: { fontSize: 11, color: colors.textSecondary },
  eventDate: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: 1 },
});
