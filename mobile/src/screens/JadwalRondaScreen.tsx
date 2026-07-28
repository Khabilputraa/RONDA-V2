// Jadwal Ronda — model kelompok. Ketua bisa buat/hapus grup manual (nama,
// warna, anggota). Bila belum ada grup manual → auto-bagi. Rotasi grup otomatis.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Icon } from '../components/Icon';
import { colors, wargaColors } from '../config/theme';
import { WargaAppBar } from '../components/warga/WargaAppBar';
import { PrimaryButton } from '../components/Card';
import { useToast } from '../components/Toast';
import { rtService } from '../services/rtService';
import { wargaDirectoryService } from '../services/wargaDirectoryService';
import { openWhatsAppPhone } from '../lib/whatsapp';
import {
  buildGroups,
  generateNights,
  groupColor,
  groupIndexOnDate,
  GROUP_COLORS,
  HARI_SHORT,
  resolveGroups,
  rondaHari,
  rondaShortDate,
  RawGroup,
  RondaGroup,
  RondaNight,
  RondaPerson,
  unassignedPeople,
} from '../lib/rondaSchedule';
import { profileIsKetua } from '../types/models';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'JadwalRonda'>;

const WINDOW_DAYS = 21;
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HARI_COL = ['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'];
const RUMAH = (n: number) => `Rumah No. ${String(n).padStart(3, '0')}`;

export default function JadwalRondaScreen({ route }: Props) {
  const { profile, rt } = route.params;
  const toast = useToast();
  const isKetua = profileIsKetua(profile);

  const [people, setPeople] = useState<RondaPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [rawGroups, setRawGroups] = useState<RawGroup[]>(rt.rondaGroups);
  const [perNight, setPerNight] = useState(rt.rondaPerNight);
  const [jamStart, setJamStart] = useState(rt.rondaStart);
  const [jamEnd, setJamEnd] = useState(rt.rondaEnd);
  const [days, setDays] = useState<number[]>(rt.rondaDays);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Buat grup baru
  const [createOpen, setCreateOpen] = useState(false);
  const [gName, setGName] = useState('');
  const [gColor, setGColor] = useState(GROUP_COLORS[0]);
  const [gMembers, setGMembers] = useState<Set<string>>(new Set());
  // Tambahkan warga belum-bergrup ke grup
  const [assignTarget, setAssignTarget] = useState<RondaPerson | null>(null);
  // Konfirmasi hapus grup (index di rawGroups)
  const [delIdx, setDelIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const dir = await wargaDirectoryService.getDirectory(rt.id);
      const sorted = dir.filter((e) => !e.isPendingImport).sort((a, b) => a.fullName.localeCompare(b.fullName));
      setPeople(sorted.map((e, i) => ({ id: e.id, name: e.fullName, no: i + 1, phone: e.phone, avatarUrl: e.avatarUrl })));
    } catch {
      // biarkan kosong
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [rt.id]);

  useEffect(() => { load(); }, [load]);

  const jam = `${jamStart} - ${jamEnd}`;
  const manualMode = rawGroups.length > 0;
  const groups = useMemo<RondaGroup[]>(
    () => (manualMode ? resolveGroups(rawGroups, people) : buildGroups(people, perNight)),
    [manualMode, rawGroups, people, perNight],
  );
  const unassigned = useMemo(() => (manualMode ? unassignedPeople(rawGroups, people) : []), [manualMode, rawGroups, people]);
  const availableForNew = useMemo(() => unassignedPeople(rawGroups, people), [rawGroups, people]);

  const nights = useMemo<RondaNight[]>(() => generateNights(groups, { days: WINDOW_DAYS, weekdays: days }), [groups, days]);
  const todayKey = useMemo(() => (nights.length > 0 && sameDay(nights[0].date, new Date()) ? nights[0].dateKey : null), [nights]);
  const selected = useMemo(() => nights.find((n) => n.dateKey === selectedKey) ?? nights[0] ?? null, [nights, selectedKey]);
  const colorOf = (g: RondaGroup) => g.color || groupColor(g.index);
  const colorForIndex = (i: number) => { const g = groups[i - 1]; return g ? colorOf(g) : groupColor(i); };
  const selGroup = selected ? groups.find((g) => g.index === selected.groupIndex) : undefined;
  const selColor = selGroup ? colorOf(selGroup) : selected ? groupColor(selected.groupIndex) : '#5B21B6';
  const selName = selGroup?.name || (selected ? `Grup ${selected.groupIndex}` : '');

  const contact = (p: RondaPerson) => {
    if (!p.phone || p.phone.replace(/\D/g, '').length < 9) { toast.error('Nomor warga belum diisi'); return; }
    openWhatsAppPhone(p.phone).then((ok) => { if (!ok) toast.error('Tidak bisa membuka WhatsApp'); });
  };

  const persistGroups = async (newRaw: RawGroup[]) => {
    setSaving(true);
    try {
      const updated = await rtService.updateRtSettings(rt.id, { ronda_groups: newRaw });
      setRawGroups(updated.rondaGroups);
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setGName(`Grup ${rawGroups.length + 1}`);
    setGColor(GROUP_COLORS[rawGroups.length % GROUP_COLORS.length]);
    setGMembers(new Set());
    setCreateOpen(true);
  };
  const toggleMember = (id: string) =>
    setGMembers((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const submitCreate = async () => {
    if (gMembers.size === 0) { toast.error('Pilih minimal 1 anggota'); return; }
    await persistGroups([...rawGroups, { name: gName.trim() || `Grup ${rawGroups.length + 1}`, color: gColor, memberIds: [...gMembers] }]);
    setCreateOpen(false);
    toast.success('Grup dibuat');
  };
  const deleteGroup = async (i: number) => {
    setDelIdx(null);
    await persistGroups(rawGroups.filter((_, idx) => idx !== i));
    toast.success('Grup dihapus');
  };
  const assignTo = async (rawIndex: number) => {
    if (!assignTarget) return;
    const next = rawGroups.map((g, i) => (i === rawIndex ? { ...g, memberIds: [...g.memberIds, assignTarget.id] } : g));
    setAssignTarget(null);
    await persistGroups(next);
    toast.success('Warga ditambahkan ke grup');
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const updated = await rtService.updateRtSettings(rt.id, {
        ronda_per_night: Math.max(1, Math.min(perNight || 3, people.length || 10)),
        ronda_start: jamStart.trim() || '22.00',
        ronda_end: jamEnd.trim() || '04.00',
        ronda_days: days.length > 0 ? days.slice().sort() : null,
      });
      setPerNight(updated.rondaPerNight);
      setJamStart(updated.rondaStart);
      setJamEnd(updated.rondaEnd);
      setDays(updated.rondaDays);
      setSettingsOpen(false);
      toast.success('Setelan ronda disimpan');
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };
  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const rotasi = useMemo(() => {
    if (groups.length === 0) return [];
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const rows: (number | null)[][] = [];
    for (let w = 0; w < 4; w++) {
      const row: (number | null)[] = [];
      for (let c = 0; c < 7; c++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + w * 7 + c);
        const active = days.length === 0 || days.includes(date.getDay());
        row.push(active ? groupIndexOnDate(date, groups.length) : null);
      }
      rows.push(row);
    }
    return rows;
  }, [groups, days]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <WargaAppBar title="Jadwal Ronda" />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.emerald} size="large" /></View>
      ) : people.length === 0 ? (
        <View style={styles.center}><Text style={styles.dim}>Belum ada data warga untuk membuat jadwal ronda.</Text></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.emerald} />}
        >
          {selected && (
            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <View style={{ flex: 1 }}>
                  <View style={styles.heroKicker}>
                    <Icon name="shield" size={13} color="rgba(255,255,255,0.9)" />
                    <Text style={styles.heroKickerText}>POS RONDA MALAM</Text>
                  </View>
                  <Text style={styles.heroGroup}>{selName}</Text>
                  <Text style={styles.heroJam}>{jam} WIB</Text>
                </View>
                {isKetua && (
                  <Pressable style={styles.heroPlus} onPress={openCreate} hitSlop={8}>
                    <Icon name="add" size={24} color="#fff" />
                  </Pressable>
                )}
              </View>
              <View style={styles.heroBadges}>
                {selected.dateKey === todayKey && (
                  <View style={styles.heroBadge}><View style={styles.dot} /><Text style={styles.heroBadgeText}>MALAM INI</Text></View>
                )}
                <View style={styles.heroBadge}><Icon name="time-outline" size={12} color="#fff" /><Text style={styles.heroBadgeText}>{jam}</Text></View>
              </View>
            </View>
          )}

          {/* Strip hari */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
            {nights.map((n) => {
              const active = selected?.dateKey === n.dateKey;
              return (
                <Pressable key={n.dateKey} style={[styles.dayCell, active && styles.dayCellActive]} onPress={() => setSelectedKey(n.dateKey)}>
                  <Text style={[styles.dayName, active && { color: '#fff' }]}>{HARI_SHORT[n.date.getDay()]}</Text>
                  <Text style={[styles.dayNum, active && { color: '#fff' }]}>{n.date.getDate()}</Text>
                  <View style={[styles.dayDot, { backgroundColor: colorForIndex(n.groupIndex) }]} />
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Belum bergrup (mode manual) */}
          {isKetua && unassigned.length > 0 && (
            <View style={styles.warnCard}>
              <View style={styles.warnHead}>
                <Icon name="alert-circle-outline" size={18} color="#B45309" />
                <Text style={styles.warnTitle}>{unassigned.length} warga belum masuk grup ronda</Text>
              </View>
              {unassigned.map((p) => (
                <View key={p.id} style={styles.warnRow}>
                  <Text style={styles.warnName}>{p.name}</Text>
                  <Pressable style={styles.warnBtn} onPress={() => setAssignTarget(p)}>
                    <Icon name="add" size={14} color={wargaColors.primaryGreen} />
                    <Text style={styles.warnBtnText}>Tambahkan ke grup</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {/* Detail hari terpilih */}
          {selected && (
            <View style={styles.detailCard}>
              <View style={styles.detailHead}>
                <View style={[styles.detailIcon, { backgroundColor: selColor }]}><Icon name="shield" size={18} color="#fff" /></View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.detailDay}>{rondaHari(selected.date)}</Text>
                    {selected.dateKey === todayKey && <View style={styles.malamPill}><Text style={styles.malamText}>Malam Ini</Text></View>}
                  </View>
                  <Text style={styles.detailSub}>{rondaShortDate(selected.date)} · {jam}</Text>
                </View>
                <View style={[styles.grupPill, { backgroundColor: selColor }]}><Text style={styles.grupPillText}>{selName}</Text></View>
              </View>
              {selected.petugas.map((p) => (
                <Pressable key={p.id} style={styles.memberRow} onPress={() => contact(p)}>
                  <Avatar person={p} size={34} bg={selColor} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.memberName}>{p.name}</Text>
                    <Text style={styles.memberNo}>{RUMAH(p.no)}</Text>
                  </View>
                  <Icon name="open-outline" size={16} color={wargaColors.primaryGreen} />
                </Pressable>
              ))}
            </View>
          )}

          {/* Kelompok Ronda */}
          <View style={styles.sectionRow}>
            <Text style={wargaText.title}>Kelompok Ronda</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={styles.miniBadge}><Text style={styles.miniBadgeText}>{groups.length} grup</Text></View>
              {isKetua && (
                <Pressable onPress={() => setSettingsOpen(true)} hitSlop={8} style={styles.gearBtn}><Icon name="settings-outline" size={18} color={wargaColors.primaryGreen} /></Pressable>
              )}
            </View>
          </View>
          {!manualMode && (
            <Text style={styles.dimSmall}>Grup dibagi otomatis. Ketua bisa tekan + untuk membuat grup sendiri.</Text>
          )}
          <View style={styles.groupGrid}>
            {(manualMode
              ? rawGroups.map((rg, i) => ({ rawIndex: i, name: rg.name || `Grup ${i + 1}`, color: rg.color || groupColor(i + 1), members: rg.memberIds.map((id) => people.find((p) => p.id === id)).filter((p): p is RondaPerson => !!p) }))
              : groups.map((g) => ({ rawIndex: -1, name: g.name || `Grup ${g.index}`, color: colorOf(g), members: g.members }))
            ).map((g, idx) => (
              <View key={idx} style={styles.groupCard}>
                <View style={styles.groupHead}>
                  <View style={[styles.groupIcon, { backgroundColor: g.color }]}><Icon name="shield" size={14} color="#fff" /></View>
                  <View style={{ marginLeft: 8, flex: 1 }}>
                    <Text style={styles.groupName} numberOfLines={1}>{g.name}</Text>
                    <Text style={styles.groupCount}>{g.members.length} anggota</Text>
                  </View>
                  {isKetua && g.rawIndex >= 0 && (
                    <Pressable onPress={() => setDelIdx(g.rawIndex)} hitSlop={6}><Icon name="trash-outline" size={16} color={wargaColors.dangerRed} /></Pressable>
                  )}
                </View>
                {g.members.map((p) => (
                  <Pressable key={p.id} style={styles.gmRow} onPress={() => contact(p)}>
                    <Avatar person={p} size={22} bg={g.color + '22'} fg={g.color} />
                    <Text style={styles.gmName} numberOfLines={1}>{p.name}</Text>
                    <Icon name="open-outline" size={13} color={colors.textHint} />
                  </Pressable>
                ))}
              </View>
            ))}
          </View>

          {/* Rotasi 4 Minggu */}
          <Text style={[wargaText.title, { marginTop: 20 }]}>Rotasi 4 Minggu</Text>
          <View style={styles.gridCard}>
            <View style={styles.gridHeadRow}>
              <View style={{ width: 26 }} />
              {HARI_COL.map((h) => <Text key={h} style={styles.gridHeadCell}>{h}</Text>)}
            </View>
            {rotasi.map((row, w) => (
              <View key={w} style={styles.gridRow}>
                <Text style={styles.gridWLabel}>W{w + 1}</Text>
                {row.map((gi, c) => (
                  <View key={c} style={styles.gridCellWrap}>
                    {gi != null ? (
                      <View style={[styles.gridCell, { backgroundColor: colorForIndex(gi) }]}><Text style={styles.gridCellText}>{gi}</Text></View>
                    ) : <View style={[styles.gridCell, styles.gridCellEmpty]} />}
                  </View>
                ))}
              </View>
            ))}
            <View style={styles.legend}>
              {groups.map((g) => (
                <View key={g.index} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colorOf(g) }]} />
                  <Text style={styles.legendText}>{g.name || `Grup ${g.index}`}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.infoCard}>
            <Icon name="information-circle-outline" size={20} color="#5B21B6" />
            <Text style={styles.infoText}>
              Jadwal ronda berlaku {days.length === 0 ? 'setiap malam' : `hari ${days.slice().sort().map((d) => HARI_SHORT[d]).join(', ')}`} pukul {jam} WIB.
              Setiap grup bertugas bergilir sesuai rotasi. Jika berhalangan, tukar dengan anggota lain atau hubungi Ketua RT.
            </Text>
          </View>
          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      {/* Modal: Buat Grup Baru */}
      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Buat Grup Baru</Text>
              <Pressable onPress={() => setCreateOpen(false)} hitSlop={8}><Icon name="close" size={22} color={colors.textSecondary} /></Pressable>
            </View>
            <Text style={styles.fieldLabel}>NAMA GRUP</Text>
            <TextInput style={styles.input} value={gName} onChangeText={setGName} placeholder="Grup 1" placeholderTextColor={colors.textHint} />
            <Text style={styles.fieldLabel}>WARNA GRUP</Text>
            <View style={styles.colorRow}>
              {GROUP_COLORS.map((c) => (
                <Pressable key={c} onPress={() => setGColor(c)} style={[styles.colorSwatch, { backgroundColor: c }, gColor === c && styles.colorSwatchOn]}>
                  {gColor === c && <Icon name="checkmark" size={16} color="#fff" />}
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>PILIH ANGGOTA {availableForNew.length === 0 ? '(semua warga sudah bergrup)' : ''}</Text>
            <View style={styles.memberPicker}>
              <ScrollView nestedScrollEnabled style={{ maxHeight: 220 }}>
                {availableForNew.map((p) => {
                  const on = gMembers.has(p.id);
                  return (
                    <Pressable key={p.id} style={styles.pickRow} onPress={() => toggleMember(p.id)}>
                      <Avatar person={p} size={32} bg={on ? gColor : colors.background} fg={colors.textSecondary} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.pickName}>{p.name}</Text>
                        <Text style={styles.pickNo}>{RUMAH(p.no)}</Text>
                      </View>
                      <Icon name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? gColor : colors.border} />
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <View style={{ height: 14 }} />
            <PrimaryButton label={saving ? 'Menyimpan...' : `Buat Grup (${gMembers.size})`} onPress={submitCreate} loading={saving} />
          </View>
        </View>
      </Modal>

      {/* Modal: Tambahkan warga ke grup */}
      <Modal visible={!!assignTarget} transparent animationType="fade" onRequestClose={() => setAssignTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Tambahkan ke grup</Text>
              <Pressable onPress={() => setAssignTarget(null)} hitSlop={8}><Icon name="close" size={22} color={colors.textSecondary} /></Pressable>
            </View>
            <Text style={styles.dimSmall}>{assignTarget?.name} akan dimasukkan ke grup:</Text>
            <View style={{ height: 8 }} />
            {rawGroups.map((g, i) => (
              <Pressable key={i} style={styles.assignRow} onPress={() => assignTo(i)}>
                <View style={[styles.groupIcon, { backgroundColor: g.color || groupColor(i + 1) }]}><Icon name="shield" size={14} color="#fff" /></View>
                <Text style={styles.assignName}>{g.name || `Grup ${i + 1}`}</Text>
                <Text style={styles.assignCount}>{g.memberIds.length} anggota</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      {/* Modal: Hapus Grup (konfirmasi) */}
      <Modal visible={delIdx != null} transparent animationType="fade" onRequestClose={() => setDelIdx(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Hapus Grup</Text>
              <Pressable onPress={() => setDelIdx(null)} hitSlop={8}><Icon name="close" size={22} color={colors.textSecondary} /></Pressable>
            </View>
            {delIdx != null && rawGroups[delIdx] && (() => {
              const g = rawGroups[delIdx];
              const names = g.memberIds.map((id) => people.find((p) => p.id === id)?.name).filter((n): n is string => !!n);
              const c = g.color || groupColor(delIdx + 1);
              return (
                <>
                  <View style={styles.delCard}>
                    <View style={[styles.groupIcon, { backgroundColor: c }]}><Icon name="shield" size={14} color="#fff" /></View>
                    <View style={{ marginLeft: 10 }}>
                      <Text style={styles.groupName}>{g.name || `Grup ${delIdx + 1}`}</Text>
                      <Text style={styles.groupCount}>{g.memberIds.length} anggota</Text>
                    </View>
                  </View>
                  <Text style={styles.delSubLabel}>ANGGOTA YANG TERDAMPAK</Text>
                  <View style={styles.delChips}>
                    {names.map((n, i) => <View key={i} style={styles.delChip}><Text style={styles.delChipText}>{n}</Text></View>)}
                  </View>
                  <View style={styles.delWarn}>
                    <Icon name="alert-circle-outline" size={16} color="#B45309" />
                    <Text style={styles.delWarnText}>Grup yang dihapus tidak bisa dikembalikan. Anggota grup ini akan menjadi "belum bergrup", tidak otomatis pindah ke grup lain.</Text>
                  </View>
                  <View style={styles.delActions}>
                    <Pressable style={[styles.delBtn, styles.delBtnCancel]} onPress={() => setDelIdx(null)}><Text style={styles.delBtnCancelText}>Batal</Text></Pressable>
                    <Pressable style={[styles.delBtn, styles.delBtnDelete, saving && { opacity: 0.6 }]} disabled={saving} onPress={() => deleteGroup(delIdx)}>
                      <Icon name="trash-outline" size={16} color="#fff" />
                      <Text style={styles.delBtnDeleteText}>Hapus</Text>
                    </Pressable>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Modal: Setelan */}
      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Setelan Ronda</Text>
              <Pressable onPress={() => setSettingsOpen(false)} hitSlop={8}><Icon name="close" size={22} color={colors.textSecondary} /></Pressable>
            </View>
            {!manualMode && (
              <>
                <Text style={styles.fieldLabel}>Anggota per grup (mode otomatis)</Text>
                <View style={styles.stepper}>
                  <Pressable style={styles.stepBtn} onPress={() => setPerNight((v) => Math.max(1, v - 1))}><Icon name="remove-circle-outline" size={24} color={wargaColors.primaryGreen} /></Pressable>
                  <Text style={styles.stepValue}>{perNight}</Text>
                  <Pressable style={styles.stepBtn} onPress={() => setPerNight((v) => Math.min(people.length || 10, v + 1))}><Icon name="add-circle-outline" size={24} color={wargaColors.primaryGreen} /></Pressable>
                </View>
              </>
            )}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Jam mulai</Text>
                <TextInput style={styles.input} value={jamStart} onChangeText={setJamStart} placeholder="22.00" placeholderTextColor={colors.textHint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Jam selesai</Text>
                <TextInput style={styles.input} value={jamEnd} onChangeText={setJamEnd} placeholder="04.00" placeholderTextColor={colors.textHint} />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Hari ronda</Text>
            <Text style={styles.fieldHint}>Kosongkan semua = tiap malam.</Text>
            <View style={styles.dayChipRow}>
              {HARI_SHORT.map((h, d) => {
                const on = days.includes(d);
                return (
                  <Pressable key={d} style={[styles.dayChip, on && styles.dayChipOn]} onPress={() => toggleDay(d)}>
                    <Text style={[styles.dayChipText, on && { color: '#fff' }]}>{h}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ height: 18 }} />
            <PrimaryButton label={saving ? 'Menyimpan...' : 'Simpan Setelan'} onPress={saveSettings} loading={saving} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase();
}

// Avatar: pakai foto profil bila ada, jika tidak tampilkan inisial.
function Avatar({ person, size, bg, fg }: { person: RondaPerson; size: number; bg: string; fg?: string }) {
  const st = { width: size, height: size, borderRadius: size / 2 };
  if (person.avatarUrl) return <Image source={{ uri: person.avatarUrl }} style={[st, { backgroundColor: bg }]} />;
  return (
    <View style={[st, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: fg ?? '#fff', fontSize: size * 0.34, fontWeight: '800' }}>{initials(person.name)}</Text>
    </View>
  );
}

const wargaText = { title: { fontSize: 16, fontWeight: '700' as const, color: colors.textPrimary } };

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: wargaColors.bgColor },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  dim: { color: colors.textSecondary, textAlign: 'center' },
  dimSmall: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  hero: { backgroundColor: '#5B21B6', borderRadius: 20, padding: 18 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start' },
  heroKicker: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroKickerText: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  heroGroup: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 6 },
  heroJam: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 2 },
  heroPlus: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  heroBadges: { flexDirection: 'row', gap: 8, marginTop: 14 },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  heroBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#34D399' },
  dayCell: { width: 56, alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingVertical: 10, gap: 3 },
  dayCellActive: { backgroundColor: '#5B21B6', borderColor: '#5B21B6' },
  dayName: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  dayNum: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  dayDot: { width: 6, height: 6, borderRadius: 3 },
  warnCard: { backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 14, padding: 14, marginTop: 14 },
  warnHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  warnTitle: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  warnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  warnName: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  warnBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: wargaColors.lightGreen },
  warnBtnText: { fontSize: 11, fontWeight: '700', color: wargaColors.primaryGreen },
  detailCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, marginTop: 14 },
  detailHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  detailIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  detailDay: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  detailSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  malamPill: { backgroundColor: '#EDE9FE', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  malamText: { fontSize: 9, fontWeight: '800', color: '#5B21B6' },
  grupPill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 110 },
  grupPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  memberName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  memberNo: { fontSize: 11, color: colors.textHint, marginTop: 1 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 6 },
  miniBadge: { backgroundColor: wargaColors.lightGreen, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  miniBadgeText: { fontSize: 11, fontWeight: '600', color: wargaColors.primaryGreen },
  gearBtn: { padding: 6, backgroundColor: wargaColors.lightGreen, borderRadius: 10 },
  groupGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginTop: 8 },
  groupCard: { width: '48%', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, marginBottom: 4 },
  groupHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  groupIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  groupName: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  groupCount: { fontSize: 10, color: colors.textSecondary },
  gmRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 5 },
  gmDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  gmDotText: { fontSize: 10, fontWeight: '800' },
  gmName: { flex: 1, fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  gridCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 12, marginTop: 10 },
  gridHeadRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  gridHeadCell: { flex: 1, textAlign: 'center', fontSize: 9, fontWeight: '700', color: colors.textSecondary },
  gridRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  gridWLabel: { width: 26, fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  gridCellWrap: { flex: 1, alignItems: 'center' },
  gridCell: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  gridCellEmpty: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  gridCellText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: colors.textSecondary },
  infoCard: { flexDirection: 'row', gap: 10, backgroundColor: '#F5F3FF', borderWidth: 1, borderColor: '#DDD6FE', borderRadius: 14, padding: 14, marginTop: 20 },
  infoText: { flex: 1, fontSize: 11.5, color: '#5B21B6', lineHeight: 18 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modalSheet: { backgroundColor: colors.surface, borderRadius: 18, padding: 18 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.4, marginTop: 14, marginBottom: 6 },
  fieldHint: { fontSize: 11, color: colors.textHint, marginTop: -4, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.textPrimary },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatch: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  colorSwatchOn: { borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, elevation: 3 },
  memberPicker: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  pickAvatarText: { fontSize: 11, fontWeight: '800', color: colors.textSecondary },
  pickName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  pickNo: { fontSize: 11, color: colors.textHint },
  assignRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 8 },
  assignName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  assignCount: { fontSize: 11, color: colors.textSecondary },
  delCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 12, padding: 12, marginTop: 6 },
  delSubLabel: { fontSize: 11, fontWeight: '700', color: wargaColors.dangerRed, letterSpacing: 0.4, marginTop: 14, marginBottom: 8 },
  delChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  delChip: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  delChipText: { fontSize: 11, color: colors.textPrimary, fontWeight: '600' },
  delWarn: { flexDirection: 'row', gap: 8, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 10, padding: 12, marginTop: 14 },
  delWarnText: { flex: 1, fontSize: 11.5, color: '#92400E', lineHeight: 17 },
  delActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  delBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46, borderRadius: 12 },
  delBtnCancel: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  delBtnCancelText: { fontWeight: '700', color: colors.textPrimary },
  delBtnDelete: { backgroundColor: wargaColors.dangerRed },
  delBtnDeleteText: { fontWeight: '700', color: '#fff' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  stepBtn: { padding: 4 },
  stepValue: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, minWidth: 32, textAlign: 'center' },
  dayChipRow: { flexDirection: 'row', gap: 6 },
  dayChip: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  dayChipOn: { backgroundColor: wargaColors.primaryGreen, borderColor: wargaColors.primaryGreen },
  dayChipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
});
