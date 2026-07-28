// Port dari lib/widgets/warga_beranda_widgets.dart (komponen inti Beranda Warga).
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../Icon';
import { colors, radius, softShadow, wargaColors, formatRupiah } from '../../config/theme';

// ── Header sapaan + avatar + lonceng notifikasi ──────────────────────
export function WargaBerandaHeader({
  greetingLine,
  fullName,
  roleRtLine,
  avatarUrl,
  notifCount,
  onNotifTap,
  onAvatarTap,
}: {
  greetingLine: string;
  fullName: string;
  roleRtLine: string;
  avatarUrl?: string | null;
  notifCount: number;
  onNotifTap?: () => void;
  onAvatarTap?: () => void;
}) {
  const initial = fullName.trim().charAt(0).toUpperCase() || 'W';
  return (
    <View style={styles.headerRow}>
      <Pressable onPress={onAvatarTap} disabled={!onAvatarTap} style={styles.avatar}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
        ) : (
          <Text style={styles.avatarText}>{initial}</Text>
        )}
      </Pressable>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.greeting}>{greetingLine}</Text>
        <Text style={styles.name} numberOfLines={1}>
          {fullName}
        </Text>
        <Text style={styles.roleLine}>{roleRtLine}</Text>
      </View>
      <Pressable onPress={onNotifTap} style={styles.bell} hitSlop={8}>
        <Icon name="notifications-outline" size={22} color={colors.textPrimary} />
        {notifCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{notifCount > 9 ? '9+' : notifCount}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

// ── Kartu total tagihan ──────────────────────────────────────────────
export function WargaTotalTagihanCard({
  total,
  bulanTertunggak,
  daysLate,
  awaitingTotal = 0,
  awaitingCount = 0,
  onTap,
}: {
  total: number;
  bulanTertunggak: number;
  daysLate?: number | null;
  awaitingTotal?: number;
  awaitingCount?: number;
  onTap?: () => void;
}) {
  // 3 status: ada tunggakan → merah; belum ada tunggakan tapi masih diverifikasi
  // Bendahara → oranye "Menunggu verifikasi"; benar-benar lunas → hijau.
  const hasDue = total > 0;
  const waiting = !hasDue && awaitingCount > 0;
  const cardStyle = hasDue ? styles.tagihanCardDue : waiting ? styles.tagihanCardWait : null;
  const labelStyle = hasDue ? styles.tagihanLabelDue : waiting ? styles.tagihanLabelWait : null;
  const subStyle = hasDue ? styles.tagihanSubDue : waiting ? styles.tagihanSubWait : null;
  const amount = hasDue ? formatRupiah(total) : waiting ? formatRupiah(awaitingTotal) : 'Lunas 🎉';
  const sub = hasDue
    ? `${bulanTertunggak} bulan belum lunas${daysLate ? ` · telat ${daysLate} hari` : ''}`
    : waiting
      ? `${awaitingCount} tagihan menunggu verifikasi Bendahara`
      : 'Tidak ada tunggakan';
  const icon: IconName = hasDue ? 'alert-circle' : waiting ? 'time-outline' : 'checkmark-done';
  return (
    <Pressable
      onPress={onTap}
      style={({ pressed }) => [styles.tagihanCard, cardStyle, pressed && { opacity: 0.9 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.tagihanLabel, labelStyle]}>Total tagihan iuran</Text>
        <Text style={styles.tagihanAmount}>{amount}</Text>
        <Text style={[styles.tagihanSub, subStyle]}>{sub}</Text>
      </View>
      <View style={styles.tagihanIcon}>
        <Icon name={icon} size={26} color="#fff" />
      </View>
    </Pressable>
  );
}

// ── Baris statistik (saldo kas, kontribusi) ──────────────────────────
export function WargaHomeStatsRow({
  saldoKas,
  totalKontribusi,
  paidCount,
  kasMasukBulanIni,
  isLoading,
  onSaldoTap,
  onKontribusiTap,
}: {
  saldoKas: number;
  totalKontribusi: number;
  paidCount: number;
  kasMasukBulanIni: number;
  isLoading?: boolean;
  onSaldoTap?: () => void;
  onKontribusiTap?: () => void;
}) {
  return (
    <View style={styles.statsRow}>
      <StatTile
        icon="cash-outline"
        tint={colors.emerald}
        label="Saldo kas RT"
        value={isLoading ? '…' : formatRupiah(saldoKas)}
        sub={`Masuk ${formatRupiah(kasMasukBulanIni)}`}
        onPress={onSaldoTap}
      />
      <StatTile
        icon="heart-outline"
        tint="#185FA5"
        label="Kontribusi saya"
        value={isLoading ? '…' : formatRupiah(totalKontribusi)}
        sub={`${paidCount}× lunas`}
        onPress={onKontribusiTap}
      />
    </View>
  );
}

function StatTile({
  icon,
  tint,
  label,
  value,
  sub,
  onPress,
}: {
  icon: IconName;
  tint: string;
  label: string;
  value: string;
  sub: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.statTile, pressed && { opacity: 0.9 }]}>
      <View style={[styles.statIcon, { backgroundColor: tint + '1A' }]}>
        <Icon name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statSub}>{sub}</Text>
    </Pressable>
  );
}

// ── Judul seksi ──────────────────────────────────────────────────────
export function WargaSectionHeader({
  title,
  showSparkle,
  trailing,
  onTrailingTap,
}: {
  title: string;
  showSparkle?: boolean;
  trailing?: string;
  onTrailingTap?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {showSparkle && <Text style={{ fontSize: 15 }}>✨</Text>}
      </View>
      {trailing != null && (
        <Pressable onPress={onTrailingTap} hitSlop={8}>
          <Text style={[styles.lihatSemua, onTrailingTap == null && { color: colors.textSecondary }]}>
            {trailing}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ── Grid aksi cepat ──────────────────────────────────────────────────
export function WargaAksiCepatGrid({
  tagihBadgeCount,
  onTagihIuran,
  onSuratRt,
  onInfo,
  onLayanan,
}: {
  tagihBadgeCount: number;
  onTagihIuran?: () => void;
  onSuratRt?: () => void;
  onInfo?: () => void;
  onLayanan?: () => void;
}) {
  return (
    <View style={styles.aksiGrid}>
      <AksiItem
        icon="card-outline"
        tint={colors.emerald}
        bg={wargaColors.lightGreen}
        label="Bayar Iuran"
        badge={tagihBadgeCount}
        onPress={onTagihIuran}
      />
      <AksiItem
        icon="document-text-outline"
        tint="#185FA5"
        bg={wargaColors.accentBlue}
        label="Surat RT"
        onPress={onSuratRt}
      />
      <AksiItem
        icon="megaphone-outline"
        tint="#BA7517"
        bg={wargaColors.accentYellow}
        label="Info RT"
        onPress={onInfo}
      />
      <AksiItem
        icon="grid-outline"
        tint={colors.emeraldDark}
        bg={wargaColors.lightGreen}
        label="Layanan"
        onPress={onLayanan}
      />
    </View>
  );
}

function AksiItem({
  icon,
  tint,
  bg,
  label,
  badge,
  onPress,
}: {
  icon: IconName;
  tint: string;
  bg: string;
  label: string;
  badge?: number;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.aksiItem, pressed && { opacity: 0.85 }]}>
      <View style={[styles.aksiIcon, { backgroundColor: bg }]}>
        <Icon name={icon} size={24} color={tint} />
        {badge != null && badge > 0 && (
          <View style={styles.aksiBadge}>
            <Text style={styles.aksiBadgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.aksiLabel}>{label}</Text>
    </Pressable>
  );
}

// ── Banner darurat ───────────────────────────────────────────────────
export function WargaDaruratBanner({ onTap }: { onTap?: () => void }) {
  return (
    <Pressable onPress={onTap} style={({ pressed }) => [styles.darurat, pressed && { opacity: 0.9 }]}>
      <View style={styles.daruratIcon}>
        <Icon name="call" size={20} color="#fff" />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.daruratTitle}>Kontak Darurat</Text>
        <Text style={styles.daruratSub}>Ketua RT, Bendahara, & nomor penting</Text>
      </View>
      <Icon name="chevron-forward" size={20} color={colors.danger} />
    </Pressable>
  );
}

// ── Header papan info ────────────────────────────────────────────────
export function WargaPapanInfoHeader({
  stripCount,
  onLihatSemua,
}: {
  stripCount: number;
  onLihatSemua?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>Papan info</Text>
      <Pressable onPress={onLihatSemua} hitSlop={8}>
        <Text style={styles.lihatSemua}>Lihat semua ({stripCount})</Text>
      </Pressable>
    </View>
  );
}

// ── Strip papan info ─────────────────────────────────────────────────
export interface PapanStripProps {
  accentColor: string;
  icon: IconName;
  iconBg: string;
  iconColor: string;
  badge: string;
  badgeBg: string;
  badgeFg: string;
  metaRight: string;
  metaRightColor?: string;
  title: string;
  subtitle: string;
  onTap?: () => void;
}

export function WargaPapanInfoStrip(p: PapanStripProps) {
  return (
    <Pressable onPress={p.onTap} style={({ pressed }) => [styles.strip, pressed && { opacity: 0.9 }]}>
      <View style={[styles.stripAccent, { backgroundColor: p.accentColor }]} />
      <View style={[styles.stripIcon, { backgroundColor: p.iconBg }]}>
        <Icon name={p.icon} size={20} color={p.iconColor} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={styles.stripTopRow}>
          <View style={[styles.stripBadge, { backgroundColor: p.badgeBg }]}>
            <Text style={[styles.stripBadgeText, { color: p.badgeFg }]}>{p.badge}</Text>
          </View>
          <Text style={[styles.stripMeta, p.metaRightColor ? { color: p.metaRightColor, fontWeight: '700' } : null]}>{p.metaRight}</Text>
        </View>
        <Text style={styles.stripTitle} numberOfLines={1}>
          {p.title}
        </Text>
        <Text style={styles.stripSubtitle} numberOfLines={1}>
          {p.subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.emeraldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontSize: 22, fontWeight: '700', color: colors.emeraldDark },
  greeting: { fontSize: 13, color: colors.textSecondary },
  name: { fontSize: 21, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.3 },
  roleLine: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  bell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  tagihanCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.emerald,
    borderRadius: radius.lg,
    padding: 18,
    ...softShadow,
  },
  tagihanCardDue: { backgroundColor: '#DC2626' },
  tagihanCardWait: { backgroundColor: '#D97706' },
  tagihanLabel: { color: '#D1FAE5', fontSize: 13, fontWeight: '500' },
  tagihanLabelDue: { color: '#FEE2E2' },
  tagihanLabelWait: { color: '#FEF3C7' },
  tagihanAmount: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  tagihanSub: { color: '#A7F3D0', fontSize: 12, marginTop: 4 },
  tagihanSubDue: { color: '#FECACA' },
  tagihanSubWait: { color: '#FDE68A' },
  tagihanIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  statsRow: { flexDirection: 'row', gap: 12 },
  statTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  statSub: { fontSize: 11, color: colors.textHint, marginTop: 2 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.2 },
  lihatSemua: { fontSize: 13, color: colors.emerald, fontWeight: '600' },

  aksiGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  aksiItem: { alignItems: 'center', width: '23%' },
  aksiIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aksiBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: colors.background,
  },
  aksiBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  aksiLabel: { fontSize: 12, color: colors.textPrimary, fontWeight: '500', marginTop: 8, textAlign: 'center' },

  darurat: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: wargaColors.lightRed,
    borderRadius: radius.lg,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FCA5A5',
  },
  daruratIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daruratTitle: { fontSize: 15, fontWeight: '700', color: '#991B1B' },
  daruratSub: { fontSize: 12, color: '#B91C1C', marginTop: 1 },

  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
    paddingLeft: 16,
    marginBottom: 10,
    overflow: 'hidden',
  },
  stripAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  stripIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stripBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  stripBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  stripMeta: { fontSize: 11, color: colors.textHint },
  stripTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginTop: 4 },
  stripSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
});
