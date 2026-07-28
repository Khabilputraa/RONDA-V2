// Port dari lib/pages/shell/main_shell.dart — shell Ketua/Bendahara (5 tab).
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../../components/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, wargaColors } from '../../config/theme';
import { Profile, RtUnit, profileIsBendahara } from '../../types/models';
import { PengurusHomeScreen } from './PengurusHomeScreen';
import { PengurusIuranScreen } from './PengurusIuranScreen';
import { PengurusKasScreen } from './PengurusKasScreen';
import { LaporanBulananView } from './LaporanBulananScreen';
import { DataWargaView } from './DataWargaScreen';
import { PengurusPengumumanScreen } from './PengurusPengumumanScreen';
import { PengurusProfilScreen } from './PengurusProfilScreen';

export type IuranKetuaMode = 'semua' | 'tagih' | 'verifikasi';
export type OfficerTabNav = (index: number, iuranMode?: IuranKetuaMode) => void;

interface Props {
  profile: Profile;
  rt: RtUnit;
  onLogout: () => void;
  onChanged: () => void;
}

// Bottom-nav 5 tab (samakan referensi). Info(5) & Profil(6) dirender di shell
// tapi diakses dari Beranda (bukan tab), maka tidak masuk daftar ini.
const TABS = [
  { key: 'home', label: 'Beranda', icon: 'home' as const, index: 0 },
  { key: 'iuran', label: 'Iuran', icon: 'wallet' as const, index: 1 },
  { key: 'kas', label: 'Kas RT', icon: 'cash' as const, index: 2 },
  { key: 'laporan', label: 'Laporan', icon: 'document-text' as const, index: 3 },
  { key: 'warga', label: 'Warga', icon: 'people' as const, index: 4 },
];

export function PengurusMainShell({ profile, rt, onLogout, onChanged }: Props) {
  const [index, setIndex] = useState(0);
  const [iuranMode, setIuranMode] = useState<IuranKetuaMode>('semua');
  const activeColor = profileIsBendahara(profile) ? '#EA580C' : colors.emerald;

  const goTab: OfficerTabNav = (i, mode) => {
    setIndex(i);
    if (i === 1) setIuranMode(mode ?? 'semua');
  };

  return (
    <View style={styles.root}>
      <View style={{ flex: 1 }}>
        {index === 0 && <PengurusHomeScreen profile={profile} rt={rt} onNavigateTab={goTab} />}
        {index === 1 && <PengurusIuranScreen profile={profile} rt={rt} mode={iuranMode} onBack={() => goTab(0)} />}
        {index === 2 && <PengurusKasScreen profile={profile} rt={rt} onBack={() => goTab(0)} />}
        {index === 3 && <LaporanBulananView profile={profile} rt={rt} onBack={() => goTab(0)} />}
        {index === 4 && <DataWargaView profile={profile} rt={rt} onBack={() => goTab(0)} />}
        {index === 5 && <PengurusPengumumanScreen profile={profile} rt={rt} onChanged={onChanged} onBack={() => goTab(0)} />}
        {index === 6 && <PengurusProfilScreen profile={profile} rt={rt} onLogout={onLogout} onProfileUpdated={onChanged} onBack={() => goTab(0)} />}
      </View>
      <SafeAreaView edges={['bottom']} style={styles.navSafe}>
        <View style={styles.nav}>
          {TABS.map((t, i) => {
            const active = i === index;
            return (
              <Pressable key={t.key} style={styles.navItem} onPress={() => goTab(i)}>
                <Icon name={active ? t.icon : (`${t.icon}-outline` as any)} size={24} color={active ? activeColor : colors.textHint} />
                <Text style={[styles.navLabel, active && { color: activeColor, fontWeight: '700' }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: wargaColors.bgColor },
  navSafe: { backgroundColor: colors.surface },
  nav: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 8,
    paddingBottom: 6,
  },
  navItem: { flex: 1, alignItems: 'center', gap: 3 },
  navLabel: { fontSize: 11, color: colors.textHint },
});
