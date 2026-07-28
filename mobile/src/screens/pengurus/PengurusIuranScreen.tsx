// Port dari lib/pages/tabs/iuran_tab.dart + ketua_iuran_bill_card.dart (mode Ketua/Bendahara)
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, formatRupiah, wargaColors } from '../../config/theme';
import { WargaCard, StatusChip, wargaText } from '../../components/warga/wargaUi';
import { WargaPageHeader } from '../../components/warga/DashboardWidgets';
import { WargaEmptyState } from '../../components/warga/PengurusWidgets';
import { PrimaryButton } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { useToast } from '../../components/Toast';
import { rtService } from '../../services/rtService';
import { familyService } from '../../services/familyService';
import {
  IuranComponent,
  IuranRecord,
  Profile,
  RtUnit,
  iuranIsAwaiting,
  iuranIsPaid,
  iuranIsUnpaid,
  profileIsBendahara,
  profileIsKetua,
  rtDisplayLabel,
} from '../../types/models';
import { groupIuranByYearMonth, iuranPeriodTitle, maxDaysLate, monthLabel } from '../../lib/period';
import { openWhatsAppTagihan } from '../../lib/whatsapp';
import type { IuranKetuaMode } from './PengurusMainShell';

const DEFAULT_AMOUNT = 50000;

interface Props {
  profile: Profile;
  rt: RtUnit;
  mode: IuranKetuaMode;
  onBack?: () => void;
}

function initials(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function PengurusIuranScreen({ rt, mode, onBack }: Props) {
  const toast = useToast();
  const [bills, setBills] = useState<IuranRecord[]>([]);
  const [members, setMembers] = useState<Record<string, Profile>>({});
  const [jiwa, setJiwa] = useState<Record<string, number>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // State khusus mode Tagih.
  const [openYears, setOpenYears] = useState<Set<number>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [remindSent, setRemindSent] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [list, memberList, jiwaMap] = await Promise.all([
      rtService.getIuranRecords(rt.id),
      rtService.getRtMembers(),
      familyService.countByHeadInRt(rt.id),
    ]);
    setBills(list);
    setMembers(Object.fromEntries(memberList.map((m) => [m.id, m])));
    setJiwa(jiwaMap);
    setLoading(false);
    setRefreshing(false);
  }, [rt.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Buka semua tahun/bulan yang punya tunggakan begitu data siap.
  useEffect(() => {
    const groups = groupIuranByYearMonth(bills.filter(iuranIsUnpaid));
    setOpenYears(new Set(groups.map((g) => g.year)));
    setOpenMonths(new Set(groups.flatMap((g) => g.months.map((m) => `${m.year}-${m.month}`))));
  }, [bills]);

  const generateMonthly = async () => {
    try {
      const n = await rtService.ensureMonthlyIuran(DEFAULT_AMOUNT);
      toast.success(n > 0 ? `${n} tagihan baru dibuat` : 'Tagihan bulan ini sudah ada');
      await load();
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    }
  };

  const createIuran = async (amountPerKk: number) => {
    const n = await rtService.ensureMonthlyIuran(amountPerKk);
    toast.success(n > 0 ? `${n} tagihan bulan ini dibuat` : 'Tagihan bulan ini sudah ada');
    setCreateOpen(false);
    await load();
  };

  const approve = async (bill: IuranRecord) => {
    setApprovingId(bill.id);
    try {
      await rtService.approveIuranAsOfficer(bill.id);
      toast.success(`Iuran ${bill.userName ?? 'warga'} disetujui`);
      await load();
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setApprovingId(null);
    }
  };

  const reject = async (bill: IuranRecord) => {
    setRejectingId(bill.id);
    try {
      await rtService.rejectIuranAsOfficer(bill.id);
      toast.success(`Bukti ${bill.userName ?? 'warga'} ditolak — warga bisa unggah ulang`);
      await load();
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setRejectingId(null);
    }
  };

  const unpaid = bills.filter(iuranIsUnpaid);
  const paid = bills.filter(iuranIsPaid);
  const awaiting = bills.filter(iuranIsAwaiting);

  // ── Mode TAGIH: layout bertingkat Tahun → Bulan → warga ──────────────
  if (mode === 'tagih') {
    const yearGroups = groupIuranByYearMonth(unpaid);
    const total = unpaid.reduce((s, b) => s + b.amount, 0);
    const kkCount = new Set(unpaid.map((b) => b.userId)).size;
    const periodeCount = yearGroups.reduce((s, y) => s + y.months.length, 0);
    const daysLate = maxDaysLate(unpaid);
    const selected = unpaid.filter((b) => selectedIds.has(b.id));

    const toggleYear = (y: number) =>
      setOpenYears((prev) => {
        const next = new Set(prev);
        next.has(y) ? next.delete(y) : next.add(y);
        return next;
      });
    const toggleMonth = (k: string) =>
      setOpenMonths((prev) => {
        const next = new Set(prev);
        next.has(k) ? next.delete(k) : next.add(k);
        return next;
      });
    const toggleSelect = (id: string) =>
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    const toggleSelectAll = () =>
      setSelectedIds((prev) => (prev.size === unpaid.length ? new Set() : new Set(unpaid.map((b) => b.id))));

    // Agregat penunggak per warga (untuk "Ingatkan Semua").
    const penunggak = (() => {
      const m = new Map<string, { userId: string; name: string; phone: string; total: number; periods: string[] }>();
      for (const b of unpaid) {
        let e = m.get(b.userId);
        if (!e) {
          e = { userId: b.userId, name: b.userName ?? members[b.userId]?.fullName ?? 'Warga', phone: members[b.userId]?.phone ?? '', total: 0, periods: [] };
          m.set(b.userId, e);
        }
        e.total += b.amount;
        const pt = iuranPeriodTitle(b);
        if (!e.periods.includes(pt)) e.periods.push(pt);
      }
      return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
    })();

    const remindOne = async (w: { userId: string; name: string; phone: string; total: number; periods: string[] }) => {
      const ok = await openWhatsAppTagihan({
        phone: w.phone,
        wargaName: w.name,
        periodLabel: w.periods.join(', '),
        amountFormatted: formatRupiah(w.total),
        rtLabel: rtDisplayLabel(rt),
      });
      if (ok) setRemindSent((s) => new Set(s).add(w.userId));
      else toast.error(`Nomor WA ${w.name} belum valid`);
    };

    const approveSelected = async () => {
      if (selected.length === 0) return;
      setBulkApproving(true);
      try {
        for (const b of selected) await rtService.approveIuranAsOfficer(b.id);
        toast.success(`${selected.length} iuran ditandai lunas`);
        setSelectedIds(new Set());
        await load();
      } catch (e: any) {
        toast.error(String(e?.message ?? e));
      } finally {
        setBulkApproving(false);
      }
    };

    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.appbar}>
          {onBack && (
            <Pressable onPress={onBack} hitSlop={8} style={styles.backBtn}>
              <Icon name="chevron-back" size={18} color={colors.textPrimary} />
            </Pressable>
          )}
          <Text style={[wargaText.sectionTitle, { flex: 1, textAlign: 'center' }]}>Tagihan Iuran</Text>
          <View style={{ width: 34 }} />
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.emerald} size="large" /></View>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={[styles.scroll, { paddingBottom: selected.length > 0 ? 20 : 100 }]}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.emerald} />}
            >
              {/* Hero merah */}
              <View style={styles.hero}>
                <View style={styles.heroTop}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="warning" size={15} color="rgba(255,255,255,0.9)" />
                    <Text style={styles.heroKicker}>TOTAL TAGIHAN</Text>
                  </View>
                  <Pressable onPress={() => setCreateOpen(true)} hitSlop={8} style={styles.heroPlus}>
                    <Icon name="add" size={20} color="#fff" />
                  </Pressable>
                </View>
                <Text style={styles.heroAmount}>{formatRupiah(total)}</Text>
                <View style={styles.heroSubRow}>
                  <Text style={styles.heroSub}>{kkCount} KK belum bayar</Text>
                  <Text style={styles.heroDot}>•</Text>
                  <Text style={styles.heroSub}>{periodeCount} periode</Text>
                  {daysLate > 0 && (
                    <>
                      <Text style={styles.heroDot}>•</Text>
                      <Icon name="calendar-outline" size={12} color="rgba(255,255,255,0.9)" />
                      <Text style={styles.heroSub}>Terlambat {daysLate} hari</Text>
                    </>
                  )}
                </View>
              </View>

              {unpaid.length > 0 && (
                <Pressable style={styles.remindAllBtn} onPress={() => setRemindOpen(true)}>
                  <Icon name="logo-whatsapp" size={18} color="#fff" />
                  <Text style={styles.remindAllText}>Ingatkan Semua ({penunggak.length})</Text>
                </Pressable>
              )}

              {/* Belum Dibayar + Pilih Semua */}
              <View style={styles.sectionRow}>
                <Text style={[wargaText.sectionTitle, { flex: 1 }]}>Belum Dibayar</Text>
                {unpaid.length > 0 && (
                  <Pressable onPress={toggleSelectAll} style={styles.pilihSemua}>
                    <Text style={styles.pilihSemuaText}>
                      {selectedIds.size === unpaid.length ? 'Batal Pilih' : 'Pilih Semua'}
                    </Text>
                  </Pressable>
                )}
              </View>

              {unpaid.length === 0 ? (
                <WargaEmptyState icon="happy-outline" message={'Semua iuran sudah lunas.\nTekan + untuk buat tagihan bulan ini.'} />
              ) : (
                yearGroups.map((yg) => {
                  const yBills = yg.months.flatMap((m) => m.items);
                  const yearTotal = yBills.reduce((s, b) => s + b.amount, 0);
                  const yOpen = openYears.has(yg.year);
                  return (
                    <View key={yg.year}>
                      <Pressable onPress={() => toggleYear(yg.year)} style={styles.yearHead}>
                        <Icon name={yOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textPrimary} />
                        <Text style={styles.yearText}>{yg.year}</Text>
                        <View style={styles.yearBadge}>
                          <Text style={styles.yearBadgeText}>{yBills.length} tagihan</Text>
                        </View>
                        <Text style={styles.yearTotal}>{formatRupiah(yearTotal)}</Text>
                      </Pressable>
                      {yOpen &&
                        yg.months.map((mg) => {
                          const key = `${mg.year}-${mg.month}`;
                          const mOpen = openMonths.has(key);
                          const mKk = new Set(mg.items.map((b) => b.userId)).size;
                          const late = maxDaysLate(mg.items);
                          return (
                            <View key={key} style={styles.monthBlock}>
                              <Pressable onPress={() => toggleMonth(key)} style={styles.monthHead}>
                                <Icon name={mOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textSecondary} />
                                <Text style={styles.monthName}>{iuranPeriodTitle(mg.items[0])}</Text>
                                {late > 0 && (
                                  <View style={styles.lateBadge}>
                                    <Text style={styles.lateBadgeText}>TERLAMBAT {late}H</Text>
                                  </View>
                                )}
                                <View style={{ flex: 1 }} />
                                <Text style={styles.monthTotal}>{formatRupiah(mg.totalAmount)}</Text>
                              </Pressable>
                              <Text style={styles.monthSub}>{mKk} KK belum bayar</Text>
                              {mOpen &&
                                mg.items.map((b) => (
                                  <WargaTagihanCard
                                    key={b.id}
                                    bill={b}
                                    jiwaCount={(jiwa[b.userId] ?? 0) + 1}
                                    rtNumber={rt.rtNumber}
                                    components={rt.iuranComponents}
                                    selected={selectedIds.has(b.id)}
                                    onToggleSelect={() => toggleSelect(b.id)}
                                  />
                                ))}
                            </View>
                          );
                        })}
                    </View>
                  );
                })
              )}
            </ScrollView>

            {selected.length > 0 && (
              <SafeAreaView edges={['bottom']} style={styles.barSafe}>
                <View style={styles.bar}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.barKicker}>{selected.length} DIPILIH</Text>
                    <Text style={styles.barTotal}>{formatRupiah(selected.reduce((s, b) => s + b.amount, 0))}</Text>
                  </View>
                  <Pressable onPress={approveSelected} disabled={bulkApproving} style={styles.barBtn}>
                    {bulkApproving ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Icon name="checkmark-circle" size={18} color="#fff" />
                        <Text style={styles.barBtnText}>Tandai Lunas</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </SafeAreaView>
            )}
          </>
        )}

        <BuatTagihanModal
          visible={createOpen}
          rt={rt}
          members={Object.values(members)}
          onClose={() => setCreateOpen(false)}
          onSubmit={createIuran}
        />

        {/* Ingatkan Semua penunggak via WhatsApp */}
        <Modal visible={remindOpen} transparent animationType="slide" onRequestClose={() => setRemindOpen(false)}>
          <View style={styles.remindBackdrop}>
            <View style={styles.remindSheet}>
              <View style={styles.remindHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.remindTitle}>Ingatkan Iuran</Text>
                  <Text style={styles.remindSub}>{penunggak.length} warga belum bayar · {remindSent.size} terkirim</Text>
                </View>
                <Pressable onPress={() => setRemindOpen(false)} hitSlop={8}><Icon name="close" size={22} color={colors.textSecondary} /></Pressable>
              </View>
              <Text style={styles.remindNote}>WhatsApp terbuka satu per satu. Ketuk "Kirim" pada tiap warga, pesan tagihan sudah otomatis terisi.</Text>
              <ScrollView style={{ maxHeight: 360 }}>
                {penunggak.map((w) => {
                  const sent = remindSent.has(w.userId);
                  const noPhone = w.phone.replace(/\D/g, '').length < 10;
                  return (
                    <View key={w.userId} style={styles.remindRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.remindName}>{w.name}</Text>
                        <Text style={styles.remindMeta}>{formatRupiah(w.total)} · {w.periods.length} periode</Text>
                      </View>
                      <Pressable
                        style={[styles.remindWaBtn, sent && styles.remindWaSent, noPhone && { opacity: 0.4 }]}
                        disabled={noPhone}
                        onPress={() => remindOne(w)}
                      >
                        <Icon name={sent ? 'checkmark' : 'logo-whatsapp'} size={16} color={sent ? wargaColors.primaryGreen : '#fff'} />
                        <Text style={[styles.remindWaText, sent && { color: wargaColors.primaryGreen }]}>{noPhone ? 'No HP -' : sent ? 'Terkirim' : 'Kirim'}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // ── Mode VERIFIKASI & overview (layout lama) ─────────────────────────
  const focused = mode === 'verifikasi';
  const title = mode === 'verifikasi' ? 'Verifikasi Iuran' : 'Iuran RT';
  const infoText = focused
    ? 'Ketuk kartu warga untuk verifikasi pembayaran iuran.'
    : 'Pantau status pembayaran iuran warga RT. Ketuk + untuk buat tagihan bulan ini.';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.emerald} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.emerald} />}
        >
          {onBack && (
            <Pressable onPress={onBack} style={styles.backRow}>
              <Icon name="chevron-back" size={18} color={wargaColors.primaryGreen} />
              <Text style={styles.backTextGreen}>Kembali ke Beranda</Text>
            </Pressable>
          )}
          <WargaPageHeader
            title={title}
            subtitle={rtDisplayLabel(rt)}
            trailing={
              <Pressable onPress={generateMonthly} style={styles.refreshBtn}>
                <Icon name="add" size={22} color={wargaColors.primaryGreen} />
              </Pressable>
            }
          />
          <View style={{ height: 16 }} />

          <WargaCard style={{ marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name="information-circle-outline" size={22} color={wargaColors.primaryGreen} />
              <Text style={[wargaText.greeting, { flex: 1, marginLeft: 12, lineHeight: 19 }]}>{infoText}</Text>
            </View>
          </WargaCard>

          {focused ? (
            <>
              <Text style={wargaText.sectionTitle}>Menunggu verifikasi</Text>
              <View style={{ height: 10 }} />
              {awaiting.length === 0 ? (
                <WargaEmptyState icon="happy-outline" message="Tidak ada pembayaran yang menunggu verifikasi." />
              ) : (
                awaiting.map((b) => (
                  <KetuaExpandableIuranCard
                    key={b.id}
                    bill={b}
                    warga={members[b.userId]}
                    rt={rt}
                    expanded={expandedId === b.id}
                    approving={approvingId === b.id}
                    rejecting={rejectingId === b.id}
                    onToggle={() => setExpandedId((cur) => (cur === b.id ? null : b.id))}
                    onApprove={() => approve(b)}
                    onReject={() => reject(b)}
                  />
                ))
              )}
              {paid.length > 0 && (
                <>
                  <View style={{ height: 16 }} />
                  <Text style={wargaText.sectionTitle}>Sudah lunas</Text>
                  <View style={{ height: 10 }} />
                  {paid.slice(0, 6).map((b) => <BillCard key={b.id} bill={b} showName />)}
                </>
              )}
            </>
          ) : (
            <>
              <Text style={wargaText.sectionTitle}>Semua Tagihan RT</Text>
              <View style={{ height: 10 }} />
              {bills.length === 0 ? (
                <WargaEmptyState icon="receipt-outline" message={'Belum ada tagihan.\nKetuk ikon refresh di atas.'} />
              ) : (
                bills.map((b) => <BillCard key={b.id} bill={b} showName />)
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// Kartu warga per tagihan (mode Tagih) — avatar, jiwa, BELUM, WA, rincian komponen.
function WargaTagihanCard({
  bill,
  jiwaCount,
  rtNumber,
  components,
  selected,
  onToggleSelect,
}: {
  bill: IuranRecord;
  jiwaCount: number;
  rtNumber: string;
  components: IuranComponent[];
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const compsTotal = (components ?? []).reduce((s, c) => s + c.amount, 0);
  const useComps = (components?.length ?? 0) > 0 && Math.round(compsTotal) === Math.round(bill.amount);
  const items = useComps
    ? components.map((c) => ({ label: c.name, amount: c.amount }))
    : [{ label: 'Iuran warga', amount: bill.amount }];

  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <View style={styles.cardHead}>
        <Pressable onPress={onToggleSelect} hitSlop={8}>
          <View style={[styles.radio, selected && styles.radioOn]}>
            {selected && <Icon name="checkmark" size={13} color="#fff" />}
          </View>
        </Pressable>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(bill.userName)}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.cardName} numberOfLines={1}>{bill.userName ?? 'Warga'}</Text>
          <View style={styles.cardMetaRow}>
            <Text style={styles.cardMeta}>RT {rtNumber}</Text>
            <Text style={styles.cardMetaDot}>•</Text>
            <Text style={styles.cardMeta}>{jiwaCount} jiwa</Text>
          </View>
        </View>
        <View style={styles.belumBadge}>
          <Text style={styles.belumText}>BELUM</Text>
        </View>
      </View>

      <View style={styles.cardBreakdown}>
        {items.map((it, idx) => (
          <View key={`${it.label}-${idx}`} style={styles.line}>
            <Icon name="ellipse-outline" size={13} color={colors.textHint} />
            <Text style={styles.lineLabel}>{it.label}</Text>
            <Text style={styles.lineAmount}>{formatRupiah(it.amount)}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>{formatRupiah(bill.amount)}</Text>
        </View>
      </View>
    </View>
  );
}

// Bottom sheet "Buat Tagihan Iuran" — pilih jenis (dgn/tanpa pengurus), jatuh tempo, catatan.
type Jenis = 'pengurus' | 'warga';

function BuatTagihanModal({
  visible,
  rt,
  members,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  rt: RtUnit;
  members: Profile[];
  onClose: () => void;
  onSubmit: (amountPerKk: number) => Promise<void>;
}) {
  const toast = useToast();
  const [jenis, setJenis] = useState<Jenis>('warga');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const comps = rt.iuranComponents ?? [];
  const compsTotal = comps.reduce((s, c) => s + c.amount, 0);
  const amountPerKk = compsTotal > 0 ? compsTotal : rt.iuranAmount || 50000;
  const items = comps.length > 0 ? comps : [{ name: 'Iuran warga', amount: amountPerKk }];

  const totalKk = members.length;
  const pengurusCount = members.filter((m) => profileIsKetua(m) || profileIsBendahara(m)).length;
  const wargaKk = Math.max(0, totalKk - pengurusCount);
  const periode = `${monthLabel(new Date().getMonth() + 1)} ${new Date().getFullYear()}`;

  const targetKk = jenis === 'pengurus' ? totalKk : wargaKk;
  const totalPerkiraan = amountPerKk * targetKk;

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit(amountPerKk);
      setDueDate('');
      setNote('');
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.mBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.mSheet}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.mHandle} />
            <View style={styles.mHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.mTitle}>Buat Tagihan Iuran</Text>
                <Text style={styles.mSubtitle}>Pilih jenis tagihan</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={8} style={styles.mCloseBtn}>
                <Icon name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.mLabel}>Jenis Tagihan</Text>
              <JenisCard
                icon="shield-outline"
                iconBg={colors.background}
                iconColor={colors.textSecondary}
                title="Iuran + Pengurus"
                subtitle={`${items.map((c) => c.name).join(' + ')} • ${totalKk} KK`}
                items={items}
                total={amountPerKk}
                selected={jenis === 'pengurus'}
                onSelect={() => setJenis('pengurus')}
              />
              <JenisCard
                icon="people"
                iconBg={wargaColors.primaryGreen}
                iconColor="#fff"
                title="Iuran Warga"
                subtitle={`${items.map((c) => c.name).join(' + ')} • ${wargaKk} KK`}
                items={items}
                total={amountPerKk}
                selected={jenis === 'warga'}
                onSelect={() => setJenis('warga')}
              />

              <Text style={[styles.mLabel, { marginTop: 18 }]}>Jatuh Tempo</Text>
              <DateField value={dueDate} onChange={setDueDate} placeholder="Pilih tanggal" />

              <Text style={[styles.mLabel, { marginTop: 18 }]}>Catatan (opsional)</Text>
              <TextInput
                style={styles.mNote}
                value={note}
                onChangeText={setNote}
                placeholder="Tambahkan catatan untuk tagihan ini..."
                placeholderTextColor={colors.textHint}
                multiline
              />

              <View style={styles.mSummary}>
                <Text style={styles.mSummaryTitle}>RINGKASAN TAGIHAN</Text>
                <SummaryLine label="Jenis" value={jenis === 'pengurus' ? 'Iuran + Pengurus' : 'Iuran Warga'} />
                <SummaryLine label="Periode" value={periode} />
                <SummaryLine label="Jumlah per KK" value={formatRupiah(amountPerKk)} />
                <SummaryLine label="Target" value={`${targetKk} KK${jenis === 'warga' ? ' (tanpa pengurus)' : ''}`} />
                <View style={styles.mSummaryDivider} />
                <View style={styles.mSummaryRow}>
                  <Text style={styles.mSummaryTotalLabel}>Total Perkiraan</Text>
                  <Text style={styles.mSummaryTotalValue}>{formatRupiah(totalPerkiraan)}</Text>
                </View>
              </View>
            </ScrollView>

            <View style={{ height: 14 }} />
            <PrimaryButton
              label={saving ? 'Membuat...' : 'Buat Tagihan'}
              onPress={submit}
              loading={saving}
              disabled={targetKk === 0}
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function JenisCard({
  icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  items,
  total,
  selected,
  onSelect,
}: {
  icon: any;
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle: string;
  items: IuranComponent[];
  total: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable onPress={onSelect} style={[styles.jenisCard, selected && styles.jenisCardOn]}>
      <View style={styles.jenisHead}>
        <View style={[styles.jenisIcon, { backgroundColor: iconBg }]}>
          <Icon name={icon} size={20} color={iconColor} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.jenisTitle}>{title}</Text>
          <Text style={styles.jenisSub}>{subtitle}</Text>
        </View>
        <View style={[styles.jenisRadio, selected && styles.jenisRadioOn]}>
          {selected && <View style={styles.jenisRadioDot} />}
        </View>
      </View>
      <View style={[styles.jenisBreakdown, selected && { backgroundColor: 'rgba(255,255,255,0.6)' }]}>
        {items.map((c, i) => (
          <View key={`${c.name}-${i}`} style={styles.jenisLine}>
            <Text style={styles.jenisLineLabel}>{c.name}</Text>
            <Text style={styles.jenisLineAmount}>{formatRupiah(c.amount)}</Text>
          </View>
        ))}
        <View style={styles.jenisTotalRow}>
          <Text style={styles.jenisTotalLabel}>Total per KK</Text>
          <Text style={[styles.jenisTotalValue, { color: selected ? wargaColors.primaryGreen : '#EA580C' }]}>
            {formatRupiah(total)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.mSummaryRow}>
      <Text style={styles.mSummaryLabel}>{label}</Text>
      <Text style={styles.mSummaryValue}>{value}</Text>
    </View>
  );
}

function BillCard({ bill, showName = false }: { bill: IuranRecord; showName?: boolean }) {
  return (
    <WargaCard style={{ marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ flex: 1 }}>
        <Text style={[wargaText.sectionTitle, { fontSize: 15 }]}>
          {showName && bill.userName ? `${bill.userName} — ${bill.periodLabel}` : bill.periodLabel}
        </Text>
        <Text style={[wargaText.greeting, { marginTop: 4 }]}>{formatRupiah(bill.amount)}</Text>
      </View>
      <StatusChip label={iuranIsPaid(bill) ? 'Lunas' : 'Belum bayar'} color={iuranIsPaid(bill) ? wargaColors.primaryGreen : '#BA7517'} />
    </WargaCard>
  );
}

function iuranCardTitle(userName: string | null, periodLabel: string): string {
  const name = userName && userName.trim().length > 0 ? userName.split(' ')[0] : 'Warga';
  const periodShort = periodLabel.split(' ')[0];
  return `${name} - ${periodShort}`;
}

function KetuaExpandableIuranCard({
  bill,
  warga,
  rt,
  expanded,
  approving,
  rejecting,
  onToggle,
  onApprove,
  onReject,
}: {
  bill: IuranRecord;
  warga?: Profile;
  rt: RtUnit;
  expanded: boolean;
  approving: boolean;
  rejecting?: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject?: () => void;
}) {
  const phone = warga?.phone ?? '';
  const hasPhone = phone.replace(/\D/g, '').length >= 9;
  const awaiting = iuranIsAwaiting(bill);
  const busy = approving || !!rejecting;

  const mention = () =>
    openWhatsAppTagihan({
      phone,
      wargaName: bill.userName ?? 'Warga',
      periodLabel: bill.periodLabel,
      amountFormatted: formatRupiah(bill.amount),
      rtLabel: rtDisplayLabel(rt),
    });

  return (
    <WargaCard style={{ marginBottom: 10 }}>
      <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={[wargaText.sectionTitle, { fontSize: 16 }]}>{iuranCardTitle(bill.userName, bill.periodLabel)}</Text>
          <Text style={[wargaText.greeting, { marginTop: 4 }]}>{formatRupiah(bill.amount)}</Text>
        </View>
        <StatusChip
          label={iuranIsPaid(bill) ? 'Lunas' : awaiting ? 'Menunggu' : 'Belum bayar'}
          color={iuranIsPaid(bill) ? wargaColors.primaryGreen : '#BA7517'}
        />
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} style={{ marginLeft: 4 }} />
      </Pressable>
      {expanded && !iuranIsPaid(bill) && (
        <View style={{ marginTop: 16 }}>
          {/* Preview bukti pembayaran yang diupload warga */}
          {awaiting && (
            <View style={{ marginBottom: 14 }}>
              <Text style={styles.proofLabel}>
                Bukti Pembayaran{bill.paymentMethod ? ` · ${bill.paymentMethod.toUpperCase()}` : ''}
              </Text>
              {bill.paymentProofUrl ? (
                <Pressable onPress={() => Linking.openURL(bill.paymentProofUrl!)}>
                  <Image source={{ uri: bill.paymentProofUrl }} style={styles.proofImg} resizeMode="contain" />
                  <Text style={styles.proofHint}>Ketuk untuk buka gambar penuh</Text>
                </Pressable>
              ) : (
                <View style={styles.proofEmpty}>
                  <Icon name="image-outline" size={26} color={colors.textHint} />
                  <Text style={styles.proofEmptyText}>Warga tidak melampirkan bukti.</Text>
                </View>
              )}
            </View>
          )}

          {awaiting ? (
            <View style={styles.verifActions}>
              <Pressable
                style={[styles.verifBtn, styles.rejectBtn, busy && { opacity: 0.5 }]}
                disabled={busy}
                onPress={onReject}
              >
                {rejecting ? (
                  <ActivityIndicator size="small" color={wargaColors.dangerRed} />
                ) : (
                  <>
                    <Icon name="close-circle-outline" size={18} color={wargaColors.dangerRed} />
                    <Text style={styles.rejectText}>Tolak</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                style={[styles.verifBtn, styles.approveBtn, busy && { opacity: 0.5 }]}
                disabled={busy}
                onPress={onApprove}
              >
                {approving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Icon name="checkmark-circle" size={18} color="#fff" />
                    <Text style={styles.approveText}>Approve</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : (
            <View style={{ marginBottom: 10 }}>
              <PrimaryButton label={approving ? 'Memproses...' : 'Tandai Lunas'} onPress={onApprove} loading={approving} />
            </View>
          )}

          <Pressable onPress={hasPhone ? mention : undefined} style={[styles.waRow, { marginTop: 12 }, !hasPhone && { opacity: 0.5 }]}>
            <Icon name="logo-whatsapp" size={20} color="#25D366" />
            <Text style={styles.waRowText}>{hasPhone ? 'Mention tagihan ke No. warga' : 'Nomor warga belum diisi'}</Text>
          </Pressable>
        </View>
      )}
    </WargaCard>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: wargaColors.bgColor },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 100 },
  appbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  backTextGreen: { color: wargaColors.primaryGreen, fontWeight: '600' },
  refreshBtn: { padding: 10, backgroundColor: wargaColors.lightGreen, borderRadius: 12 },

  // Hero merah
  hero: {
    padding: 18, borderRadius: 18, backgroundColor: '#DC2626',
    shadowColor: wargaColors.dangerRed, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroKicker: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  heroPlus: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  heroAmount: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 10 },
  heroSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, flexWrap: 'wrap' },
  heroSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  heroDot: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 12 },
  pilihSemua: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: wargaColors.dangerRed },
  pilihSemuaText: { fontSize: 12, fontWeight: '600', color: wargaColors.dangerRed },
  remindAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, minHeight: 46, borderRadius: 12, backgroundColor: '#25D366' },
  remindAllText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  remindBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  remindSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 28 },
  remindHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  remindTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  remindSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  remindNote: { fontSize: 12, color: colors.textSecondary, backgroundColor: colors.background, borderRadius: 10, padding: 10, marginBottom: 10, lineHeight: 17 },
  remindRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  remindName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  remindMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  remindWaBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#25D366' },
  remindWaSent: { backgroundColor: wargaColors.lightGreen },
  remindWaText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  yearHead: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFF5F5', borderRadius: 12, borderWidth: 1, borderColor: '#FECACA',
  },
  yearText: { fontWeight: '700', color: colors.textPrimary },
  yearBadge: { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: wargaColors.lightRed, borderRadius: 8 },
  yearBadgeText: { fontSize: 10, fontWeight: '600', color: wargaColors.dangerRed },
  yearTotal: { flex: 1, textAlign: 'right', fontWeight: '700', color: wargaColors.dangerRed },

  monthBlock: { marginBottom: 6 },
  monthHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  monthName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  monthTotal: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  monthSub: { fontSize: 11, color: colors.textSecondary, marginLeft: 22, marginBottom: 8 },
  lateBadge: { marginLeft: 4, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: wargaColors.lightRed, borderRadius: 4 },
  lateBadgeText: { fontSize: 8, fontWeight: '700', color: wargaColors.dangerRed },

  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10, marginLeft: 8 },
  cardSelected: { borderColor: wargaColors.dangerRed, borderWidth: 1.5 },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  radioOn: { backgroundColor: wargaColors.dangerRed, borderColor: wargaColors.dangerRed },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: wargaColors.dangerRed, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cardName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  cardMeta: { fontSize: 11, color: colors.textSecondary },
  cardMetaDot: { fontSize: 11, color: colors.textHint },
  belumBadge: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: wargaColors.lightRed, borderRadius: 6, marginRight: 8 },
  belumText: { fontSize: 9, fontWeight: '700', color: wargaColors.dangerRed },
  waBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#25D366', alignItems: 'center', justifyContent: 'center' },

  cardBreakdown: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10 },
  line: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  lineLabel: { flex: 1, marginLeft: 8, fontSize: 13, color: colors.textSecondary },
  lineAmount: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  totalRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8 },
  totalLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  totalAmount: { fontSize: 14, fontWeight: '800', color: wargaColors.dangerRed },

  barSafe: { backgroundColor: wargaColors.primaryGreen },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: wargaColors.primaryGreen, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  barKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600' },
  barTotal: { color: '#fff', fontSize: 20, fontWeight: '700' },
  barBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', minWidth: 130, justifyContent: 'center' },
  barBtnText: { color: '#fff', fontWeight: '700' },

  waRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#25D366' },
  waRowText: { color: '#25D366', fontWeight: '600' },
  proofLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 8 },
  proofImg: { width: '100%', height: 260, borderRadius: 12, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: colors.border },
  proofHint: { fontSize: 11, color: colors.textHint, textAlign: 'center', marginTop: 6, fontStyle: 'italic' },
  proofEmpty: { height: 120, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center', gap: 6 },
  proofEmptyText: { fontSize: 12, color: colors.textHint, fontStyle: 'italic' },
  verifActions: { flexDirection: 'row', gap: 10 },
  verifBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46, borderRadius: 12 },
  rejectBtn: { borderWidth: 1, borderColor: wargaColors.dangerRed },
  rejectText: { color: wargaColors.dangerRed, fontWeight: '700' },
  approveBtn: { backgroundColor: wargaColors.primaryGreen },
  approveText: { color: '#fff', fontWeight: '700' },

  // Buat Tagihan modal
  mBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  mSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
  mHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 14 },
  mHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  mTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  mSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  mCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  mLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
  mField: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  mFieldInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 },
  mNote: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: colors.textPrimary, minHeight: 76, textAlignVertical: 'top' },

  jenisCard: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, padding: 12, marginBottom: 12, backgroundColor: colors.surface },
  jenisCardOn: { borderColor: wargaColors.primaryGreen, backgroundColor: wargaColors.lightGreen },
  jenisHead: { flexDirection: 'row', alignItems: 'center' },
  jenisIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  jenisTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  jenisSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  jenisRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  jenisRadioOn: { borderColor: wargaColors.primaryGreen },
  jenisRadioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: wargaColors.primaryGreen },
  jenisBreakdown: { marginTop: 12, backgroundColor: colors.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  jenisLine: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  jenisLineLabel: { fontSize: 12, color: colors.textSecondary },
  jenisLineAmount: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  jenisTotalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8, marginTop: 2 },
  jenisTotalLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  jenisTotalValue: { fontSize: 13, fontWeight: '800' },

  mSummary: { marginTop: 18, backgroundColor: colors.background, borderRadius: 14, padding: 14 },
  mSummaryTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.textSecondary, marginBottom: 10 },
  mSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  mSummaryLabel: { fontSize: 13, color: colors.textSecondary },
  mSummaryValue: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  mSummaryDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 },
  mSummaryTotalLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  mSummaryTotalValue: { fontSize: 16, fontWeight: '800', color: wargaColors.primaryGreen },
});
