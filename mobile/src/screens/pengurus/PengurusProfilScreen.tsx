// Port dari lib/pages/tabs/profil_tab.dart — redesain: header + stat + Informasi + Kelola RT
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { alertDialog, confirmDialog } from '../../lib/dialog';
import { Icon, type IconName } from '../../components/Icon';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, formatRupiah, wargaColors } from '../../config/theme';
import { WargaMenuTile, WargaProfileAvatar } from '../../components/warga/DashboardWidgets';
import { EditProfileModal } from '../../components/warga/EditProfileModal';
import { NotifikasiSheet, PrivasiSheet, countNotifActive, loadNotifPrefs } from '../../components/warga/SettingsSheets';
import { useToast } from '../../components/Toast';
import { authService } from '../../services/authService';
import { rtService } from '../../services/rtService';
import { wargaDirectoryService } from '../../services/wargaDirectoryService';
import { familyService } from '../../services/familyService';
import { Profile, RtUnit, profileIsBendahara, profileIsKetua, profileRoleLabel, rtDisplayLabel } from '../../types/models';
import type { RootStackParamList } from '../../navigation/types';

interface Props {
  profile: Profile;
  rt: RtUnit;
  onLogout: () => void;
  onProfileUpdated?: () => void;
}

export function PengurusProfilScreen({ profile: initialProfile, rt, onLogout, onProfileUpdated }: Props) {
  const toast = useToast();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [editing, setEditing] = useState(false);
  const [saldo, setSaldo] = useState<number | null>(null);
  const [totalWarga, setTotalWarga] = useState<number | null>(null);
  const [inviteCode, setInviteCode] = useState(rt.inviteCode);
  const [regenBusy, setRegenBusy] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [privasiOpen, setPrivasiOpen] = useState(false);
  const [notifActive, setNotifActive] = useState(4);

  useEffect(() => {
    loadNotifPrefs(initialProfile.id).then((p) => setNotifActive(countNotifActive(p)));
  }, [initialProfile.id]);
  const canManage = profileIsKetua(profile) || profileIsBendahara(profile);

  const regenerateCode = () =>
    confirmDialog(
      'Ganti kode undangan?',
      'Kode lama akan langsung tidak berlaku. Warga yang belum bergabung harus memakai kode baru.',
      async () => {
        setRegenBusy(true);
        try {
          const code = await rtService.regenerateInviteCode(rt.id);
          setInviteCode(code);
          toast.success('Kode undangan diperbarui');
        } catch (e: any) {
          toast.error(String(e?.message ?? e));
        } finally {
          setRegenBusy(false);
        }
      },
      'Ganti kode',
    );

  useEffect(() => {
    (async () => {
      try {
        const ks = await rtService.getKasSummary(rt.id);
        setSaldo(ks.saldo);
      } catch {
        // abaikan
      }
      try {
        // Total Warga = total jiwa: kepala keluarga terdaftar + semua anggota keluarga.
        const [dir, anggota] = await Promise.all([
          wargaDirectoryService.getDirectory(rt.id),
          familyService.countInRt(rt.id).catch(() => 0),
        ]);
        const kk = dir.filter((e) => !e.isPendingImport).length;
        setTotalWarga(kk + anggota);
      } catch {
        // abaikan
      }
    })();
  }, [rt.id]);

  const onSaved = async () => {
    const updated = await authService.getProfile();
    if (updated) {
      setProfile(updated);
      onProfileUpdated?.();
      toast.success('Profil diperbarui');
    }
  };

  const showHelp = () =>
    alertDialog(
      'Panduan RT OS',
      '• Beranda: ringkasan kas & pengumuman.\n' +
        '• Iuran: kelola tagihan warga.\n' +
        '• Kas: catat pemasukan & pengeluaran.\n' +
        '• Info: buat & kelola pengumuman.\n' +
        '• Profil: edit data & kelola warga.',
    );

  const confirmLogout = () =>
    confirmDialog('Keluar?', 'Anda akan keluar dari aplikasi.', onLogout, 'Keluar');

  const waPhone = profile.phone.length > 0 ? profile.phone : 'Belum diisi';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Kartu profil */}
        <View style={styles.headerCard}>
          <View style={styles.headerBand} />
          <View style={{ marginTop: -44 }}>
            <WargaProfileAvatar
              imageUrl={profile.avatarUrl}
              fullName={profile.fullName}
              radius={44}
              showCameraBadge
              onTap={() => setEditing(true)}
            />
          </View>
          <Text style={styles.headerName}>{profile.fullName}</Text>
          <View style={styles.roleBadge}>
            <Icon name="business" size={12} color={wargaColors.primaryGreen} />
            <Text style={styles.roleBadgeText}>{profileRoleLabel(profile)}</Text>
            <View style={styles.onlineDot} />
          </View>
          <Text style={styles.headerSub}>{rtDisplayLabel(rt)} · {rt.name}</Text>
        </View>

        {/* 3 stat tiles */}
        <View style={styles.statRow}>
          <StatTile icon="home" color="#185FA5" value={rtDisplayLabel(rt)} label="RT / RW" />
          <StatTile icon="people" color={wargaColors.primaryGreen} value={totalWarga == null ? '—' : String(totalWarga)} label="TOTAL WARGA" />
          <StatTile icon="wallet" color="#5B21B6" value={saldo == null ? '—' : formatRupiah(saldo)} label="SALDO KAS" />
        </View>

        {/* Informasi */}
        <Text style={styles.sectionLabel}>Informasi</Text>
        <WargaMenuTile
          icon="notifications-outline"
          iconBg={wargaColors.lightGreen}
          iconColor={wargaColors.primaryGreen}
          title="Notifikasi"
          subtitle={notifActive === 0 ? 'Nonaktif' : `${notifActive} dari 4 aktif`}
          onTap={() => setNotifOpen(true)}
        />
        <WargaMenuTile
          icon="shield-outline"
          iconBg={wargaColors.accentBlue}
          iconColor="#185FA5"
          title="Privasi & Keamanan"
          subtitle="Kelola keamanan akun"
          onTap={() => setPrivasiOpen(true)}
        />
        <WargaMenuTile
          icon="home-outline"
          iconBg={wargaColors.accentYellow}
          iconColor="#BA7517"
          title="Alamat"
          subtitle={rt.address ?? rt.name}
          onTap={() => setEditing(true)}
        />
        <WargaMenuTile
          icon="call"
          iconBg={wargaColors.lightGreen}
          iconColor={wargaColors.primaryGreen}
          title="WhatsApp"
          subtitle={waPhone}
          onTap={() => setEditing(true)}
        />

        {/* Kelola RT */}
        <View style={{ height: 12 }} />
        <Text style={styles.sectionLabel}>Kelola RT</Text>
        {profileIsKetua(profile) && (
          <View style={styles.inviteCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inviteLabel}>Kode undangan RT</Text>
              <Text style={styles.inviteCode}>{inviteCode}</Text>
            </View>
            <Pressable
              hitSlop={8}
              disabled={regenBusy}
              style={[styles.copyBtn, regenBusy && { opacity: 0.5 }]}
              onPress={regenerateCode}
            >
              <Icon name="refresh" size={18} color={wargaColors.primaryGreen} />
            </Pressable>
            <Pressable
              hitSlop={8}
              style={styles.copyBtn}
              onPress={async () => {
                try {
                  const nav = (globalThis as any).navigator;
                  if (nav?.clipboard?.writeText) await nav.clipboard.writeText(inviteCode);
                  else await Clipboard.setStringAsync(inviteCode);
                } catch {
                  await Clipboard.setStringAsync(inviteCode);
                }
                toast.success('Kode berhasil disalin');
              }}
            >
              <Icon name="copy-outline" size={18} color={wargaColors.primaryGreen} />
            </Pressable>
          </View>
        )}
        {canManage && (
          <WargaMenuTile
            icon="people"
            iconBg={wargaColors.lightGreen}
            iconColor={wargaColors.primaryGreen}
            title="Data Warga"
            subtitle="Direktori & kelola bendahara"
            onTap={() => navigation.navigate('DataWarga', { profile, rt })}
          />
        )}
        {profileIsKetua(profile) && (
          <WargaMenuTile
            icon="construct-outline"
            iconBg={wargaColors.accentBlue}
            iconColor="#185FA5"
            title="Pengaturan RT"
            subtitle="Alamat, rekening, kop surat, tanda tangan, QRIS"
            onTap={() => navigation.navigate('RtSettings', { profile, rt })}
          />
        )}
        <WargaMenuTile
          icon="shield-outline"
          iconBg={wargaColors.accentLime}
          iconColor="#3B6D11"
          title="Verifikasi Surat"
          subtitle="Kelola permohonan surat warga"
          onTap={() => navigation.navigate('SuratPengantar', { profile, rt })}
        />
        <WargaMenuTile
          icon="help-circle"
          iconBg={wargaColors.accentBlue}
          iconColor="#185FA5"
          title="Bantuan"
          subtitle="Panduan singkat RT OS"
          onTap={showHelp}
        />

        <View style={{ height: 20 }} />
        <Pressable onPress={confirmLogout} style={styles.logout}>
          <Icon name="log-out-outline" size={20} color={wargaColors.dangerRed} />
          <Text style={styles.logoutText}>Keluar</Text>
        </Pressable>
        <Text style={styles.version}>RT OS Indonesia v1.0</Text>
      </ScrollView>

      <EditProfileModal
        visible={editing}
        userId={profile.id}
        initialName={profile.fullName}
        initialPhone={profile.phone}
        initialAvatarUrl={profile.avatarUrl}
        initialNik={profile.nik}
        initialBirthPlace={profile.birthPlace}
        initialBirthDate={profile.birthDate}
        initialOccupation={profile.occupation}
        initialGender={profile.gender}
        initialReligion={profile.religion}
        initialMaritalStatus={profile.maritalStatus}
        onClose={() => setEditing(false)}
        onSaved={onSaved}
      />

      <NotifikasiSheet
        visible={notifOpen}
        userId={profile.id}
        onClose={() => setNotifOpen(false)}
        onSaved={(p) => setNotifActive(countNotifActive(p))}
      />
      <PrivasiSheet visible={privasiOpen} userId={profile.id} onClose={() => setPrivasiOpen(false)} />
    </SafeAreaView>
  );
}

function StatTile({ icon, color, value, label }: { icon: IconName; color: string; value: string; label: string }) {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIcon, { backgroundColor: color + '1F' }]}>
        <Icon name={icon} size={18} color={color} />
      </View>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: wargaColors.bgColor },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 100 },
  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingBottom: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  headerBand: { height: 68, alignSelf: 'stretch', backgroundColor: wargaColors.lightGreen },
  headerName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginTop: 8 },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: wargaColors.lightGreen,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 8,
  },
  roleBadgeText: { fontSize: 12, fontWeight: '600', color: wargaColors.primaryGreen },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: wargaColors.primaryGreen, marginLeft: 2 },
  headerSub: { fontSize: 12, color: colors.textSecondary, marginTop: 8 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 6,
  },
  statIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  statLabel: { fontSize: 10, color: colors.textSecondary, marginTop: 2, letterSpacing: 0.3 },
  sectionLabel: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  inviteLabel: { fontSize: 12, color: colors.textSecondary },
  inviteCode: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, letterSpacing: 1, marginTop: 2 },
  copyBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: wargaColors.lightGreen },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: wargaColors.dangerRed },
  logoutText: { color: wargaColors.dangerRed, fontWeight: '600', fontSize: 15 },
  version: { textAlign: 'center', fontSize: 12, color: colors.textSecondary, marginTop: 16 },
});
