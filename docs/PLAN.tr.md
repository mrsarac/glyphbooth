# Glyphbooth — Ürün ve Uygulama Planı

Tarih: 2026-10-06 (gece çalışması). Yazan: Claude, Patron'un isteğiyle.
Bu plan, prompt atlasındaki üç tekniği kullanır: **görev sözleşmesi**, **premortem** ve **belirsizlik sözleşmesi**.

## 1. Fikir

Örnek alınan ürün: Luis Bizarro'nun *Visualizer.app* uygulaması. Rust ve WebGPU ile yazılmış. Sese tepki veren parçacıklar çizer. Mürekkep, ASCII ve halftone görünümleri vardır.

Glyphbooth bu fikri bir adım öteye taşır: **sadece sesi değil, her şeyi canlı glif sanatına çevirir.**

- Kameran → seni gerçek zamanlı ASCII, dither, halftone veya braille olarak gösterir.
- Ekranın, bir video, bir fotoğraf veya yazdığın bir kelime → aynı şekilde.
- Müzik, mikrofon veya dahili demo ritmi → görüntü vuruşlarla nefes alır.
- Çıktı paylaşılabilir: PNG, sesli WebM video, panoya düz metin ASCII, renkli HTML.

Tek cümle: **"Kendini ASCII olarak gör, müzikle dans ettir, tek tuşla paylaş."**

İnsanları etkileyen an: uygulama açılır açılmaz izin istemeden bir sahne ve ritim çalar. `C` tuşuna basınca kişi kendini glif olarak görür. `T` tuşuna basınca kendi yüzünü düz metin olarak Slack'e yapıştırabilir.

## 2. Görev sözleşmesi

| Alan | Değer |
|---|---|
| Amaç | Yarın sabah açık kaynak, indirilebilir, etkileyici bir görsel uygulama yayında olsun. |
| Girdi | Visualizer.app (ilham), Patron'un tercihleri (TR klavye: kısayollar harf/rakam; büyük okunur yazı). |
| Çıktı | 1) Public GitHub reposu `mrsarac/glyphbooth`, MIT lisansı. 2) Canlı web demo (GitHub Pages). 3) v0.1.0 sürümü: macOS `.dmg`, Windows `.exe`, Linux `.AppImage`. |
| Bitiş ölçütü | `npm test` ve uçtan uca duman testi geçer. Uygulama konsolda hata vermeden açılır. Her mod ve her kaynak en az bir kez çizilir. |
| Eksik bilgi | Karar Patron'a kalmasın diye makul varsayılan seçilir ve bu dosyada yazılır (bölüm 5). |

## 3. Teknik seçimler

| Konu | Seçim | Neden |
|---|---|---|
| Görüntü | WebGL2, ham shader'lar, kütüphane yok | Her tarayıcıda ve Electron'da çalışır. WebGPU henüz her yerde yok. |
| Uygulama kabuğu | Electron + electron-builder | Kamera, mikrofon ve ekran yakalama Electron'da en az sorun çıkarır. Tauri daha küçük ama Linux'ta kamera güvenilir değil. |
| Dil / derleme | TypeScript + Vite | Hızlı, sade, tek bir web paketi hem web demosunu hem masaüstünü besler. |
| Ses | Web Audio API, `AnalyserNode` | Bas, orta, tiz enerjisi ve vuruş algılama. Dahili demo ritmi Web Audio ile sentezlenir; telif sorunu yok. |
| Font | JetBrains Mono (OFL), paketin içinde | Glif atlası her makinede aynı çıkar; çevrimdışı çalışır. |
| Test | Vitest (saf mantık) + Playwright (sahte kamera ile duman testi) | "Hata vermeyen kod" hedefi ölçülebilir olur. |
| Dağıtım | GitHub Actions: CI, Pages, etiketle sürüm | Üç platform ikili dosyası makineye bağımlı olmadan üretilir. |

## 4. Görüntü hattı (render pipeline)

1. **Kaynak geçişi**: video, görsel veya prosedürel sahne bir dokuya çizilir. Parlaklık, kontrast, ayna ve vuruşta yakınlaşma burada uygulanır. Sonra mipmap üretilir; böylece hücre ortalaması tek okuma ile alınır.
2. **Efekt geçişi**: seçili mod çizilir.
   - `ASCII`: hücre parlaklığı → glif atlası. Karakter setleri mürekkep yoğunluğuna göre otomatik sıralanır. İsteğe bağlı kenar modu: Sobel yönüne göre `| / - \` gelir.
   - `Dither`: Bayer 8×8 veya mavi gürültü eşiği, paletin en yakın rengine düşürülür.
   - `Halftone`: döndürülmüş nokta ızgarası.
   - `Braille`: her hücre 2×4 nokta.
   - `Pixel`: düz mozaik + palet.
3. **Son işlem**: renk ayrışması (vuruşta), tarama çizgileri, gren, vinyet, vuruş flaşı.
4. **Metin geri okuma**: küçük bir hücre dokusu okunur, ASCII metne dönüşür (panoya kopyala, `.txt`, renkli `.html`).

## 5. Belirsizlik sözleşmesi (verdiğim varsayımlar)

Bilmediğim konularda şu kararları verdim. Patron isterse sabah değiştirir.

1. **Ad**: Glyphbooth (glif + fotoğraf kabini). GitHub'da boştu.
2. **Arayüz dili**: İngilizce varsayılan, tarayıcı dili Türkçe ise Türkçe. Açık kaynak kitlesi küresel.
3. **İmza**: macOS sürümü Apple ile imzalı değil. README, ilk açılışta ne yapılacağını adım adım yazar.
4. **Sistem sesi**: macOS'ta sistem sesini yakalamak ek izin ve yerel kod ister. v0.1'de mikrofon, dosya ve demo ritmi var. Windows'ta ekran paylaşımı sistem sesini de alır.
5. **İlham hakkı**: Visualizer'ın kodu veya shader'ı kopyalanmadı. README ilham kaynağını anar.

## 6. Premortem — "Sabah açtık ve kötüydü. Neden?"

| Olası başarısızlık | Sonuç | Önlem |
|---|---|---|
| Kamera izni reddedilir | Siyah ekran, kullanıcı gider | Açılışta izin istenmez; demo sahne + demo ritim çalar. Hata olursa uyarı çıkar, sahneye dönülür. |
| WebGL2 yok | Boş sayfa | Açık bir mesaj gösterilir. |
| Ses bağlamı kullanıcı tıklamadan başlamaz | Sessiz demo | Giriş ekranındaki "Başla" tıklaması sesi açar. |
| Font geç yüklenir | Atlas yanlış fontla oluşur | Atlas, `document.fonts.load` tamamlanınca kurulur. |
| macOS uygulamayı engeller | "Hasarlı" uyarısı | README'de `xattr` komutu ve sağ tık → Aç adımı. |
| Kayıt formatı desteklenmez | Kayıt düğmesi hata verir | `MediaRecorder.isTypeSupported` ile vp9 → vp8 → webm sırasıyla denenir. |
| Yavaş makinede kare düşer | Takılma | Kaynak çözünürlüğü sınırlı; DPR en fazla 2. |
| Pages alt yolunda dosya bulunmaz | 404 | Vite `base: './'`. |

## 7. Kısayollar (TR klavyede rahat: sadece harf ve rakam)

| Tuş | İş |
|---|---|
| 1–5 | Mod: ASCII, Dither, Halftone, Braille, Pixel |
| P | Sonraki palet |
| G | Sonraki hazır ayar (preset) |
| R | Rastgele karıştır |
| C | Kamera |
| N | Sonraki sahne |
| M | Mikrofon |
| D | Demo ritmi aç/kapat |
| S | PNG kaydet |
| V | Video kaydı başlat/durdur |
| T | ASCII metni panoya kopyala |
| F | Tam ekran |
| H | Paneli gizle/göster |

## 8. İş sırası

1. İskelet: Vite + TS + Electron, lint ve test komutları.
2. Görüntü hattı + sahneler + modlar.
3. Ses motoru + vuruş algılama + demo sentez.
4. Arayüz paneli + kısayollar + presetler + URL'de durum.
5. Dışa aktarma: PNG, WebM, metin, HTML.
6. Testler: birim + Playwright duman testi.
7. README, ekran görüntüleri, GIF.
8. GitHub: repo, Pages, sürüm iş akışı, v0.1.0 etiketi.

## 9. Sonraki sürümler için fikirler (v0.1'de yok)

- macOS sistem sesi (ScreenCaptureKit).
- GIF dışa aktarma.
- MIDI kontrolcü ile canlı performans.
- Yüz algılama ile glif yoğunluğunu yüze odaklama.
- Terminal sürümü: aynı çıktıyı `glyphbooth --tty` ile terminale basmak.
