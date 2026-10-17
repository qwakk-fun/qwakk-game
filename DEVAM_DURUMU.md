# Devam sonucu: 17 Ekim 2026

Kullanıcının paylaştığı CapRover loguna göre yayına aldığı sürüm `3516cf4`.
Aşağıdaki işler ana `qwakk-game` dalına birleştirilen 0.2.0 sürümünü oluşturur.
Deploy sonraki adımdır. Önceki Claude worktree'leri korunuyor.

## Tamamlananlar

- **İsimler:** Sarı ördek Qwakk, turkuaz ördek Toski. Büyük harita Yelova,
  deathmatch kasabası Kavren. Bölgeler Kumra, Sarpin, Kavren, Akyel, Harman,
  Yolca, Koru ve Tanoba; küçük yer tarifleri Türkçe/İngilizce çevrilir.
  Teknik harita, karakter ve oda kimlikleri korunur. Harita kaynakları yeniden
  üretildi; isimler dışındaki JSON verisi ve arazi ikili dosyaları birebir aynı.

- **Qwakk ve Toski:** Menü seçimi, kayıt, 3D önizleme, tüm katılma yolları,
  sunucu doğrulaması, diğer oyuncuların görünümü ve dengeli bot dağılımı birleştirildi.
  Aynı iskelet, animasyon, silahlar ve hitbox tablosu kullanılıyor.
- **Toski görünürlüğü:** Turkuaz kafa, marka sarısı gövde ve kep, daha belirgin
  dış hat. Çim, çit ve taş üzerinde 10/25/50 m kontrollü karşılaştırmaların
  dokuzu geçti. Toski/Qwakk kontrast oranı 1,084 ile 1,420 arasında.
  Yöntem ve kapsam: `docs/character-readability.md`.
- **Kask:** Toski'nin kepi ve dış hattı kask takılınca gizleniyor. Her iki kask
  seviyesi kontrol edildi. Önceden başın içine gömülen kask modeli de düzeltildi.
- **Yükleme:** Başarısız model istekleri önbelleğe takılmıyor; oyun 5 saniye
  sonra tekrar deniyor. Menü, 3D yüklenene kadar seçilen karakterin görselinde kalıyor.
- **Render boyutu:** Git'e girecek iki WebP toplam yaklaşık 48 KB.
  Yaklaşık 15 MB PNG yerel olarak yeniden üretilebilir ve gitignore kapsamındadır.
- **Admin paneli:** `/admin`, parola + TOTP, oturum ve deneme sınırları,
  canlı oyuncu/oda/sunucu durumu, oda yönetimi, oyuncu çıkarma ve engelleme,
  bot zorluğu, sunucunun belirlediği hasar ve maç ayarları, duyuru, bakım modu,
  isim filtresi ve işlem günlüğü. PostgreSQL ile ayarlar yeniden başlatmada korunur.
  Giriş formunun Chrome'daki Origin hatası düzeltildi.
- **Türkçe:** Menü, dokunmatik kontroller, oyun HUD'ı, bekleme ve sonuç ekranları,
  eşya/çanta ekranları ve oyun yönergeleri. Üst menüden Türkçe/English seçilir.
  İlk ziyarette tarayıcı dili kullanılır; seçim hatırlanır. `?lang=tr` ve
  `?lang=en` de desteklenir. Admin paneli şu an İngilizce.
- **Oyuncu isimleri:** Yalnızca oyuncuya 12 metreden yakın canlı ördeklerde
  küçük ve soluk isimler gösterilir; 6 metreden sonra solup 12 metrede kaybolur.
  Kendi isim etiketi ve etiket kutuları kaldırıldı. Takım arkadaşları yeşildir.
  Rakip için hem sunucudan gelen poz hem gerçek kafa/gövdeye açık görüş gerekir;
  ince duvar, etiketin duvar üstünde kalması ve pozun kaybolması kontrolleri var.

## Doğrulama

- Typecheck ve üretim derlemesi geçti.
- 0.2.0 üretim Docker imajı yerelde derlendi ve geçici container ile doğrulandı:
  sağlık, oyun menüsü, iki dilde Qwakk/Toski adları ve korumalı admin API'si.
- 395 test geçti: shared 87, client 72, server 236. Yerel PostgreSQL testleri dahil.
- Deathmatch, battle royale, lobi, parti/ikili takım ve mobil dokunmatik e2e'leri geçti.
- BR kasa arama adımı ilk çalışmada uygun kasa bulamadı; bağımsız tekrarında
  kasa açma, envanterden alma, bırakma, geri alma ve maç sonu geçti.
- Ağ kopması, gizli sekme ve birikmiş girdilerden toparlanma testi geçti.
- Admin tarayıcı e2e'si Node 24 ile de geçti: 2FA, beş sayfa, ayar kalıcılığı,
  yabancı origin reddi, doğrulama, duyuru, yeniden başlatma ve çıkış.
- Dil e2e'si: tarayıcı dili, dil değiştirme ve yenileme, karakter kaydı,
  bozuk model isteğinden kurtulma, telefon görünümü ve Türkçe oyun HUD'ı.
- GLB iskelet/ölçü doğrulaması geçti. Üretim oyun paketinde admin kodu veya
  geliştirme/test sayfası ve kancaları bulunmadı.
- Kurulum QR kodları kısa metin, authenticator URI'si ve 200 bayt örnekle
  macOS'un QR okuyucusunda doğru çözüldü.
- Telefon emülasyonu: 844x390, DPR 3, 1266x585 çizim, WebGPU ve 4x CPU
  yavaşlatmayla tüm ölçülen aşamalarda ortalama 16,7 ms (yaklaşık 60 FPS).
  CPU ortalamaları: DM 7,33 ms, BR yerde 6,52 ms. DM p95 en yüksek örneği
  19,60 ms; bu yüzden her karenin 60 FPS olduğu iddia edilmiyor.
- Gerçek telefon ve Safari henüz doğrulanmadı.

Test logları ve ekran görüntüleri: `/private/tmp/qwakk-continuation/`.
Yerel önizleme için açılmış bağımsız süreçler kapatıldı. Geliştirme artık
tek terminalde `npm run dev` ile açılır: yerel PostgreSQL, oyun sunucusu,
istemci ve admin derleme izleyicisi. Chrome veya sekme kendiliğinden açılmaz.
Admin girişi mevcut sunucu ortamındaki parola hash'i ve TOTP anahtarıyla elle yapılır.
Yalnızca açıkça `--open` verilirse geçici bilgilerle Chrome önizlemesi açılır.
`Ctrl+C` alt süreç gruplarını ve varsa önizleme tarayıcısını kapatır; veritabanı
verileri korunur. Aynı anda ikinci bir geliştirme komutu çalıştırılmaz.

## Admin panelini yayında açma

1. Bu değişiklikler commit'lenip deploy edilecek sürüme dahil edilmeli.
   `caprover deploy -b main` yalnızca son commit'i gönderir; kaydedilmemiş
   çalışma dosyalarını göndermez.
2. `qwakk-game` içinde `npm run admin:setup` çalıştır. Kendi parolanı gir,
   QR'ı authenticator uygulamasında okut.
3. Çıktıdaki `ADMIN_PASSWORD_HASH` ve `ADMIN_TOTP_SECRET` değerlerini CapRover
   uygulamasının ortam değişkenlerine ekle. Mevcut `DATABASE_URL` korunmalı.
   Yeni veritabanı migration'ı sunucu başlangıcında otomatik çalışır.
4. `https://play.qwakk.fun/admin` adresine parola ve 6 haneli kodla gir.

Bu iki değişken yokken panel 404 döner. Ayrıntılar: `docs/deploy.md`,
"Admin panel" bölümü. Hareket/fizik ve istemcinin tahmin ettiği silah sayıları
panelden değiştirilmez; onların değiştirilmesi yeni istemci derlemesi gerektirir.


## Blender ve kural uyumu kontrolü

- Toski aksesuarları Blender kaynak betiklerinde hafifletildi: **9.980 üçgen,
  5.072 köşe, yaklaşık 352 KB GLB**. Qwakk 9.856 üçgen. Ortak iskelet,
  bağlama pozu, hitbox ve marka ana renkleri korunuyor.
- 10 bin üçgen üst sınırı GLB doğrulayıcıya ve model testlerine eklendi.
- Tam Blender üretimi tekrar alındı: `.blend` kaynak dosyası ve 28 animasyon
  kaydı mevcut. Yayınlanan animasyon GLB'si öncekiyle byte düzeyinde aynı.
- `--no-anim` hızlı üretimi artık tam `.blend` dosyasını veya animasyon
  istatistiklerini silmiyor. Hash ve içerik karşılaştırmasıyla doğrulandı.
- Güncel modelin dokuz görünürlük kontrolü ve iki kask seviyesi tekrar geçti.
  Gerçek oyun içinden çatışma, nişan ve şarjör değiştirme kareleri de alınıp incelendi:
  `/private/tmp/qwakk-continuation/compliance-shots/`.
- Yukarıdaki telefon performans ölçümü aksesuarlar hafifletilmeden önceki
  modelle alınmıştı. Yeni modele ait görünürlük sonuçları
  `/private/tmp/qwakk-continuation/characters-compliance/contrast.json` içinde.
