// Port dari lib/pages/pengumuman/create_announcement_page.dart
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon, type IconName } from '../../components/Icon';
import { ANNOUNCEMENT_TEMPLATES, AnnouncementTemplate, TemplateField } from '../../lib/announcementTemplates';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors, radius, wargaColors } from '../../config/theme';
import { WargaAppBar } from '../../components/warga/WargaAppBar';
import { PrimaryButton } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { hariFromDate, indoToISO } from '../../lib/dateInput';
import { wargaText } from '../../components/warga/wargaUi';
import { useToast } from '../../components/Toast';
import { rtService } from '../../services/rtService';
import { wargaDirectoryService } from '../../services/wargaDirectoryService';
import { directoryIsWarga } from '../../types/directory';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateAnnouncement'>;

const BULAN_FULL = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const fmtIndo = (d: Date) => `${d.getDate()} ${BULAN_FULL[d.getMonth()]} ${d.getFullYear()}`;

export default function CreateAnnouncementScreen({ route, navigation }: Props) {
  const { rtId, onCreated, editing } = route.params;
  const isEditing = !!editing;
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [hari, setHari] = useState('');
  const [tanggal, setTanggal] = useState('');
  const [jam, setJam] = useState('');
  const [lokasi, setLokasi] = useState('');
  const [jamOptions, setJamOptions] = useState<string[]>([]);
  const [lokasiOptions, setLokasiOptions] = useState<string[]>([]);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string | string[]>>({});
  const [templateContent, setTemplateContent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Daftar kepala keluarga + alamat (untuk field wargaSelect, mis. Ucapan Duka Cita).
  const [wargaList, setWargaList] = useState<{ name: string; address: string }[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [dir, rt] = await Promise.all([
          wargaDirectoryService.getDirectory(rtId).catch(() => []),
          rtService.getRtById(rtId).catch(() => null),
        ]);
        const rtAddr = rt?.address ?? '';
        setWargaList(
          dir
            .filter(directoryIsWarga)
            .map((e) => ({ name: e.fullName, address: e.blokRumah && e.blokRumah.trim() !== '' ? e.blokRumah : rtAddr })),
        );
      } catch {
        // abaikan
      }
    })();
  }, [rtId]);

  // Mode edit: prefill dari pengumuman yang dipilih (form disederhanakan).
  useEffect(() => {
    if (!editing) return;
    setTitle(editing.title);
    setContent(editing.content);
    setPinned(editing.isPinned);
    if (editing.eventDate) setTanggal(fmtIndo(editing.eventDate));
  }, [editing]);

  // Ganti tiap token ({AGENDA}, {NOMINAL}, ...) di template dengan nilai field.
  const fillContent = (tpl: string, flds: TemplateField[], values: Record<string, string | string[]>) => {
    let out = tpl;
    for (const f of flds) {
      const v = values[f.token];
      let text: string;
      if (f.type === 'multiselect') {
        const arr = (v as string[]) ?? [];
        text = arr.length > 0 ? arr.map((a, i) => `${i + 1}. ${a}`).join('\n') : `(pilih ${f.label.toLowerCase()})`;
      } else {
        const s = ((v as string) ?? '').trim();
        text = s !== '' ? s : `(isi ${f.label.toLowerCase()})`;
      }
      out = out.split(f.token).join(text);
    }
    return out;
  };

  const updateField = (token: string, value: string | string[]) => {
    updateFields({ [token]: value });
  };

  // Update beberapa field sekaligus (mis. Nama + Alamat) lalu rebuild isi sekali.
  const updateFields = (patch: Record<string, string | string[]>) => {
    const next = { ...fieldValues, ...patch };
    setFieldValues(next);
    setContent(fillContent(templateContent, fields, next));
  };

  // Pilih kepala keluarga -> isi Nama + Alamat (dari data warga / RT) sekaligus.
  const pickWarga = (f: TemplateField, name: string) => {
    const w = wargaList.find((x) => x.name === name);
    const patch: Record<string, string | string[]> = { [f.token]: name };
    if (f.autoAddressToken) patch[f.autoAddressToken] = w?.address ?? '';
    updateFields(patch);
  };

  const applyTemplate = (t: AnnouncementTemplate) => {
    setTitle(t.title);
    if (t.suggestPinned) setPinned(true);
    // Jam & Lokasi -> dropdown preset dari template (reset pilihan sebelumnya).
    setJamOptions(t.jamOptions ?? []);
    setLokasiOptions(t.lokasiOptions ?? []);
    setJam('');
    setLokasi('');
    // Field template (dropdown/teks) untuk placeholder di isi.
    const flds = t.fields ?? [];
    const init: Record<string, string | string[]> = {};
    for (const f of flds) init[f.token] = f.type === 'multiselect' ? [] : '';
    setFields(flds);
    setFieldValues(init);
    setTemplateContent(t.content);
    setContent(fillContent(t.content, flds, init));
    setPickerOpen(false);
  };

  const clearTemplate = () => {
    setTitle('');
    setContent('');
    setJamOptions([]);
    setLokasiOptions([]);
    setFields([]);
    setFieldValues({});
    setTemplateContent('');
    setPickerOpen(false);
  };

  const submit = async () => {
    if (title.trim() === '') return toast.error('Judul wajib diisi');
    if (content.trim() === '') return toast.error('Isi pengumuman wajib diisi');

    // ── Mode EDIT: form sederhana (judul, isi, tanggal kegiatan, pin) ──
    if (isEditing) {
      if (tanggal.trim() === '') return toast.error('Tanggal kegiatan wajib diisi');
      const isoE = indoToISO(tanggal.trim());
      const parsedE = new Date(isoE ? `${isoE}T00:00:00` : tanggal.trim());
      const evd = !isNaN(parsedE.getTime()) ? parsedE : editing!.eventDate;
      if (evd == null) return toast.error('Tanggal kegiatan tidak valid');
      setSaving(true);
      try {
        await rtService.updateAnnouncement(editing!.id, {
          title: title.trim(),
          content: content.trim(),
          isPinned: pinned,
          eventDate: evd,
        });
        toast.success('Pengumuman diperbarui');
        onCreated?.();
        navigation.goBack();
      } catch (e: any) {
        toast.error(`Gagal: ${String(e?.message ?? e)}`);
      } finally {
        setSaving(false);
      }
      return;
    }

    // Field template wajib dilengkapi.
    for (const f of fields) {
      const v = fieldValues[f.token];
      const empty = f.type === 'multiselect' ? !(v as string[])?.length : !((v as string) ?? '').trim();
      if (empty) return toast.error(`Lengkapi: ${f.label}`);
    }
    if (hari.trim() === '') return toast.error('Hari wajib diisi');
    if (tanggal.trim() === '') return toast.error('Tanggal kegiatan wajib diisi');
    if (jam.trim() === '') return toast.error('Jam wajib diisi');
    if (lokasi.trim() === '') return toast.error('Lokasi wajib diisi');

    // Tanggal kegiatan WAJIB valid → eventDate tak boleh null, agar pengumuman
    // otomatis pindah ke arsip/Riwayat setelah tanggalnya lewat.
    const iso = indoToISO(tanggal.trim());
    const parsed = new Date(iso ? `${iso}T00:00:00` : tanggal.trim());
    if (isNaN(parsed.getTime())) return toast.error('Tanggal kegiatan tidak valid');
    const parsedDate: Date = parsed;

    setSaving(true);
    try {
      // Susun: Pembukaan -> Isi (narasi) -> Jadwal -> Penutup.
      // Jadwal disisipkan SEBELUM paragraf terakhir (penutup), setelah isi utama.
      const jadwal =
        `🗓️ Hari/Tanggal: ${hari.trim()}, ${tanggal.trim()}\n` +
        `⏰ Jam: ${jam.trim()}\n` +
        `📍 Lokasi: ${lokasi.trim()}`;
      const paras = content.trim().split(/\n{2,}/);
      let fullContent: string;
      if (paras.length >= 3) {
        // pembukaan + isi ... -> jadwal -> penutup (paragraf terakhir)
        const penutup = paras[paras.length - 1];
        const awal = paras.slice(0, -1).join('\n\n');
        fullContent = `${awal}\n\n${jadwal}\n\n${penutup}`;
      } else {
        // 1-2 paragraf: jadwal ditaruh di bawah isi
        fullContent = `${paras.join('\n\n')}\n\n${jadwal}`;
      }

      await rtService.createAnnouncement({
        rtId,
        title: title.trim(),
        content: fullContent,
        isPinned: pinned,
        eventDate: parsedDate,
      });
      toast.success('Pengumuman dipublikasikan');
      onCreated?.();
      navigation.goBack();
    } catch (e: any) {
      toast.error(`Gagal: ${String(e?.message ?? e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <WargaAppBar title={isEditing ? 'Edit Pengumuman' : 'Buat Pengumuman'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {!isEditing && (
          <>
          <Text style={styles.label}>Gunakan template (opsional)</Text>
          <View style={[styles.selectWrap, pickerOpen && { zIndex: 100 }]}>
            <Pressable style={[styles.dropdown, pickerOpen && styles.dropdownOpen]} onPress={() => setPickerOpen((o) => !o)}>
              <Icon name="document-text-outline" size={18} color={wargaColors.primaryGreen} />
              <Text style={[styles.dropdownText, title === '' && { color: colors.textHint }]} numberOfLines={1}>
                {title === '' ? 'Pilih template pengumuman…' : title}
              </Text>
              <Icon name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
            </Pressable>
            {pickerOpen && (
              <View style={styles.menu}>
                <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {ANNOUNCEMENT_TEMPLATES.map((t) => {
                    const selected = title === t.title;
                    return (
                      <Pressable key={t.title} style={[styles.optionRow, selected && styles.optionRowActive]} onPress={() => applyTemplate(t)}>
                        <Icon name="megaphone-outline" size={16} color={wargaColors.primaryGreen} />
                        <Text style={[styles.optionText, selected && { color: wargaColors.primaryGreen, fontWeight: '600' }]}>{t.title}</Text>
                        {selected && <Icon name="checkmark" size={16} color={wargaColors.primaryGreen} />}
                      </Pressable>
                    );
                  })}
                  <Pressable style={styles.optionRow} onPress={clearTemplate}>
                    <Icon name="create-outline" size={16} color={colors.textSecondary} />
                    <Text style={[styles.optionText, { color: colors.textSecondary }]}>Judul lain (tulis sendiri)</Text>
                  </Pressable>
                </ScrollView>
              </View>
            )}
          </View>
          <Text style={styles.helperSmall}>Opsional — mengisi Judul & Isi otomatis, lalu bisa diedit. Judul di bawah yang tampil ke warga.</Text>
          </>
          )}

          <Text style={styles.label}>Judul</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Contoh: Kerja Bakti Lingkungan" placeholderTextColor={colors.textHint} />

          {fields.map((f, i) => (
            <View key={f.token} style={{ position: 'relative', zIndex: fields.length - i }}>
              <Text style={styles.label}>{f.label}</Text>
              {f.type === 'multiselect' ? (
                <AgendaSelect options={f.options ?? []} selected={(fieldValues[f.token] as string[]) ?? []} onChange={(v) => updateField(f.token, v)} />
              ) : f.type === 'wargaSelect' ? (
                <TemplateSelect
                  value={(fieldValues[f.token] as string) ?? ''}
                  options={wargaList.map((w) => w.name)}
                  placeholder={wargaList.length === 0 ? 'Belum ada data warga' : 'Pilih kepala keluarga'}
                  onChange={(v) => pickWarga(f, v)}
                />
              ) : f.type === 'select' ? (
                <TemplateSelect value={(fieldValues[f.token] as string) ?? ''} options={f.options ?? []} placeholder={`Pilih ${f.label.toLowerCase()}`} onChange={(v) => updateField(f.token, v)} />
              ) : (
                <TextInput
                  style={styles.input}
                  value={(fieldValues[f.token] as string) ?? ''}
                  onChangeText={(v) => updateField(f.token, v)}
                  placeholder={f.placeholder ?? ''}
                  placeholderTextColor={colors.textHint}
                />
              )}
            </View>
          ))}
          {fields.length > 0 && (
            <Text style={styles.helperSmall}>Isi/pilih di atas — otomatis masuk ke isi pengumuman.</Text>
          )}

          <Text style={styles.label}>Isi pengumuman</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={content}
            onChangeText={setContent}
            multiline
            placeholder="Jelaskan kegiatan, lokasi, dan hal yang perlu disiapkan warga…"
            placeholderTextColor={colors.textHint}
          />

          {isEditing ? (
            <>
              <Text style={styles.label}>Tanggal Kegiatan (wajib)</Text>
              <Text style={styles.helperSmall}>Dipakai untuk arsip — pengumuman pindah ke Riwayat setelah tanggal ini lewat.</Text>
              <DateField value={tanggal} onChange={setTanggal} placeholder="20 Juli 2026" />
            </>
          ) : (
          <>
          <Text style={styles.label}>Detail Kegiatan (wajib)</Text>
          <Text style={styles.helperSmall}>Otomatis ditampilkan di bagian atas pengumuman.</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.subLabel}>Hari</Text>
              <TextInput style={styles.input} value={hari} onChangeText={setHari} placeholder="Contoh: Minggu" placeholderTextColor={colors.textHint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.subLabel}>Tanggal</Text>
              <DateField
                value={tanggal}
                onChange={(v) => {
                  setTanggal(v);
                  const h = hariFromDate(v);
                  if (h) setHari(h); // isi Hari otomatis dari tanggal terpilih
                }}
                placeholder="20 Juli 2026"
              />
            </View>
          </View>
          <Text style={styles.subLabel}>Jam</Text>
          {jamOptions.length > 0 ? (
            <TemplateSelect value={jam} options={jamOptions} placeholder="Pilih jam" onChange={setJam} />
          ) : (
            <TextInput style={styles.input} value={jam} onChangeText={setJam} placeholder="Contoh: 07.00 WIB s.d. selesai" placeholderTextColor={colors.textHint} />
          )}
          <Text style={styles.subLabel}>Lokasi</Text>
          {lokasiOptions.length > 0 ? (
            <TemplateSelect value={lokasi} options={lokasiOptions} placeholder="Pilih lokasi" onChange={setLokasi} />
          ) : (
            <TextInput style={styles.input} value={lokasi} onChangeText={setLokasi} placeholder="Contoh: Lapangan RT / Balai Warga" placeholderTextColor={colors.textHint} />
          )}
          </>
          )}

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={[wargaText.sectionTitle, { fontSize: 15 }]}>Tandai penting (pin)</Text>
              <Text style={[wargaText.greeting, { fontSize: 12 }]}>Muncul di badge notifikasi Home</Text>
            </View>
            <Switch value={pinned} onValueChange={setPinned} trackColor={{ true: wargaColors.primaryGreen }} />
          </View>

          <View style={{ height: 24 }} />
          <PrimaryButton label={saving ? 'Menyimpan...' : isEditing ? 'Simpan Perubahan' : 'Publikasikan'} onPress={submit} loading={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Dropdown pilihan (jam/lokasi) dari preset template; ada opsi "tulis sendiri".
function TemplateSelect({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);

  if (custom) {
    return (
      <View>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textHint}
          autoFocus
        />
        <Pressable onPress={() => setCustom(false)} hitSlop={6}>
          <Text style={styles.linkSmall}>← Pilih dari daftar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.selectWrap, open && { zIndex: 100 }]}>
      <Pressable style={[styles.dropdown, open && styles.dropdownOpen]} onPress={() => setOpen((o) => !o)}>
        <Text style={[styles.dropdownText, value === '' && { color: colors.textHint }]} numberOfLines={1}>
          {value === '' ? placeholder : value}
        </Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </Pressable>
      {open && (
        <View style={styles.menu}>
          <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {options.map((opt) => {
              const selected = value === opt;
              return (
                <Pressable key={opt} style={[styles.optionRow, selected && styles.optionRowActive]} onPress={() => { onChange(opt); setOpen(false); }}>
                  <Text style={[styles.optionText, selected && { color: wargaColors.primaryGreen, fontWeight: '600' }]}>{opt}</Text>
                  {selected && <Icon name="checkmark" size={16} color={wargaColors.primaryGreen} />}
                </Pressable>
              );
            })}
            <Pressable style={styles.optionRow} onPress={() => { setCustom(true); setOpen(false); onChange(''); }}>
              <Icon name="create-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.optionText, { color: colors.textSecondary }]}>Lainnya (tulis sendiri)</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// Dropdown multi-pilih agenda rapat.
function AgendaSelect({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);
    setOpen(false); // tutup setelah memilih; buka lagi untuk menambah agenda lain
  };
  const label = selected.length === 0 ? 'Pilih agenda…' : `${selected.length} agenda dipilih`;

  return (
    <View style={[styles.selectWrap, open && { zIndex: 100 }]}>
      <Pressable style={[styles.dropdown, open && styles.dropdownOpen]} onPress={() => setOpen((o) => !o)}>
        <Icon name="list-outline" size={18} color={wargaColors.primaryGreen} />
        <Text style={[styles.dropdownText, selected.length === 0 && { color: colors.textHint }]} numberOfLines={1}>
          {label}
        </Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </Pressable>
      {open && (
        <View style={styles.menu}>
          <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {options.map((opt) => {
              const on = selected.includes(opt);
              return (
                <Pressable key={opt} style={[styles.optionRow, on && styles.optionRowActive]} onPress={() => toggle(opt)}>
                  <Icon name={on ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={on ? wargaColors.primaryGreen : colors.textSecondary} />
                  <Text style={[styles.optionText, on && { color: wargaColors.primaryGreen, fontWeight: '600' }]}>{opt}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: wargaColors.bgColor },
  linkSmall: { fontSize: 12, color: wargaColors.primaryGreen, fontWeight: '600', marginTop: 6 },
  scroll: { padding: 16, paddingBottom: 32 },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginTop: 14, marginBottom: 8 },
  subLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  dropdownOpen: { borderColor: wargaColors.primaryGreen },
  dropdownText: { flex: 1, fontSize: 15, color: colors.textPrimary },
  helperSmall: { fontSize: 12, color: colors.textSecondary, marginTop: 6 },
  selectWrap: { position: 'relative' },
  menu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    zIndex: 200,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionRowActive: { backgroundColor: wargaColors.lightGreen },
  optionText: { flex: 1, fontSize: 14, color: colors.textPrimary },
  imageBox: {
    width: '100%',
    backgroundColor: wargaColors.lightGreen,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(5,150,105,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  imageHint: { color: wargaColors.primaryGreen, fontWeight: '600', marginTop: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
});
