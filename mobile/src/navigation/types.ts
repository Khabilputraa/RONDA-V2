import type { Announcement, Profile, RtUnit, SuratRequest } from '../types/models';
import type { SuratItem } from '../lib/suratCatalog';

export type WargaParams = { profile: Profile; rt: RtUnit };

export type RootStackParamList = {
  Splash: undefined;
  Login: undefined;
  Home: undefined;
  AnnouncementDetail: { announcement: Announcement };
  WargaTagihanIuran: { profile: Profile; rt: RtUnit; onDone?: () => void };
  WargaKontakDarurat: WargaParams;
  JadwalRonda: WargaParams;
  WargaKontribusiSaya: WargaParams;
  WargaRiwayatTransaksi: WargaParams;
  WargaLayanan: WargaParams;
  WargaLayananSurat: { profile: Profile; rt: RtUnit; initialSuratType?: string };
  WargaSuratForm: { profile: Profile; rt: RtUnit; suratItem: SuratItem; onSubmitted?: (suratType?: string) => void };
  WargaSuratCustom: { profile: Profile; rt: RtUnit; onSubmitted?: (suratType?: string) => void };
  SuratDraft: { rt: RtUnit; request: SuratRequest; ketuaName: string };
  CreateAnnouncement: { rtId: string; onCreated?: () => void; editing?: Announcement };
  SuratPengantar: WargaParams;
  DataWarga: WargaParams;
  FamilyMembers: { rt: RtUnit; headId: string; headName: string };
  LaporanBulanan: WargaParams;
  RtSettings: { profile: Profile; rt: RtUnit; onSaved?: (rt: RtUnit) => void };
  CreateRt: { onSuccess?: () => void };
  JoinRt: { additionalMembership?: boolean; onSuccess?: () => void };
};
