import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import { ToastProvider } from './src/components/Toast';
import SplashScreen from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import AnnouncementDetailScreen from './src/screens/pengumuman/AnnouncementDetailScreen';
import WargaTagihanIuranScreen from './src/screens/warga/WargaTagihanIuranScreen';
import WargaKontakDaruratScreen from './src/screens/warga/WargaKontakDaruratScreen';
import JadwalRondaScreen from './src/screens/JadwalRondaScreen';
import WargaKontribusiSayaScreen from './src/screens/warga/WargaKontribusiSayaScreen';
import WargaRiwayatTransaksiScreen from './src/screens/warga/WargaRiwayatTransaksiScreen';
import WargaLayananScreen from './src/screens/warga/WargaLayananScreen';
import WargaLayananSuratScreen from './src/screens/warga/WargaLayananSuratScreen';
import WargaSuratFormScreen from './src/screens/warga/WargaSuratFormScreen';
import WargaSuratCustomScreen from './src/screens/warga/WargaSuratCustomScreen';
import CreateAnnouncementScreen from './src/screens/pengurus/CreateAnnouncementScreen';
import SuratPengantarScreen from './src/screens/pengurus/SuratPengantarScreen';
import SuratDraftScreen from './src/screens/pengurus/SuratDraftScreen';
import DataWargaScreen from './src/screens/pengurus/DataWargaScreen';
import FamilyMembersScreen from './src/screens/pengurus/FamilyMembersScreen';
import LaporanBulananScreen from './src/screens/pengurus/LaporanBulananScreen';
import RtSettingsScreen from './src/screens/pengurus/RtSettingsScreen';
import CreateRtScreen from './src/screens/onboarding/CreateRtScreen';
import JoinRtScreen from './src/screens/onboarding/JoinRtScreen';
import type { RootStackParamList } from './src/navigation/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  // Font Outfit opsional — app tetap jalan dengan font sistem bila gagal dimuat.
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ToastProvider>
        <StatusBar style="dark" />
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
            <Stack.Screen name="Splash" component={SplashScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen
              name="AnnouncementDetail"
              component={AnnouncementDetailScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="WargaTagihanIuran"
              component={WargaTagihanIuranScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen name="WargaKontakDarurat" component={WargaKontakDaruratScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="JadwalRonda" component={JadwalRondaScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="WargaKontribusiSaya" component={WargaKontribusiSayaScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="WargaRiwayatTransaksi" component={WargaRiwayatTransaksiScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="WargaLayanan" component={WargaLayananScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="WargaLayananSurat" component={WargaLayananSuratScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="WargaSuratForm" component={WargaSuratFormScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="WargaSuratCustom" component={WargaSuratCustomScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="SuratDraft" component={SuratDraftScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="CreateAnnouncement" component={CreateAnnouncementScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="SuratPengantar" component={SuratPengantarScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="DataWarga" component={DataWargaScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="FamilyMembers" component={FamilyMembersScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="LaporanBulanan" component={LaporanBulananScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="RtSettings" component={RtSettingsScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="CreateRt" component={CreateRtScreen} options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="JoinRt" component={JoinRtScreen} options={{ animation: 'slide_from_right' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
