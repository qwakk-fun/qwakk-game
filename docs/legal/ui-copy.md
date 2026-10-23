# Account flow copy (English and Turkish)

Copy for the new account flow, ready to move into `apps/client/src/ui/menu/copy.en.ts` and `copy.tr.ts`. Keys are suggestions; rename them to fit the code. `{email}`, `{name}`, `{n}`, `{s}` and `{date}` are values filled in by the code.

Rules this copy follows: no em dashes, the heading, supporting line and main button of each screen say different things, errors are our own words (never the raw text from the server, Cloudflare or the email provider), and nothing promises rewards, prizes or money value. Turkish uses the informal "sen", like the rest of the menu.

## 1. Sign-in screen

| Key | English | Turkish |
| --- | --- | --- |
| `auth.title` | Keep your ducks | Ördeklerin seninle kalsın |
| `auth.sub` | No passwords. Your ducks, stats and looks follow you to any device. | Şifre yok. Ördeklerin, istatistiklerin ve görünümlerin her cihazda seninle. |
| `auth.emailLabel` | Email | E-posta |
| `auth.emailPlaceholder` | you@example.com | sen@ornek.com |
| `auth.emailHint` | Only for sign-in codes and, if you want, news. | Sadece giriş kodları ve istersen haberler için. |
| `auth.send` (button) | Send code | Kodu gönder |
| `auth.sending` | Quacking it over... | Kod yolda... |
| `auth.or` | or | veya |
| `auth.guest` (link) | Play as guest (Deathmatch only) | Misafir olarak oyna (sadece Deathmatch) |
| `auth.guestNote` | Guest ducks live in this browser only. Clear your browser data and they are gone. | Misafir ördekler sadece bu tarayıcıda yaşar. Tarayıcı verilerini silersen onlar da gider. |
| `auth.qorex` (disabled button) | Sign in with QoreX (soon) | QoreX ile giriş (yakında) |
| `auth.qorexNote` | Identity only. No rewards, no transactions. | Sadece kimlik için. Ödül yok, işlem yok. |

The QoreX button stays disabled and not clickable until wallet sign-in works end to end. Do not wire it to anything that opens the wallet.

## 2. Code entry

| Key | English | Turkish |
| --- | --- | --- |
| `code.title` | Check your inbox | Gelen kutuna bak |
| `code.sub` | We sent a 6-digit code to {email}. It works for 10 minutes. | {email} adresine 6 haneli bir kod gönderdik. Kod 10 dakika geçerli. |
| `code.label` | 6-digit code | 6 haneli kod |
| `code.submit` (button) | Continue | Devam et |
| `code.checking` | Checking... | Kontrol ediliyor... |
| `code.spam` | Nothing yet? Peek in your spam folder. | Gelmedi mi? Spam klasörüne bir göz at. |
| `code.resend` (link) | Resend code | Kodu tekrar gönder |
| `code.resendIn` | Resend in {s} s | {s} sn sonra tekrar gönderebilirsin |
| `code.resent` | Fresh code sent. Use the newest one. | Yeni kod gönderildi. En son geleni kullan. |
| `code.changeEmail` (link) | Use a different email | Başka bir e-posta kullan |

## 3. Errors

Map each server error code to one of these. Never show the server's or provider's own text.

| Key | English | Turkish |
| --- | --- | --- |
| `errors.email_invalid` | That email looks off. Check it and try again. | Bu e-posta hatalı görünüyor. Kontrol edip tekrar dene. |
| `errors.code_format` | The code is 6 digits. | Kod 6 haneden oluşur. |
| `errors.code_wrong` | That code does not match. Check the email and try again. | Kod eşleşmedi. E-postayı kontrol edip tekrar dene. |
| `errors.code_wrong_left` | Wrong code. {n} tries left. | Kod yanlış. {n} deneme hakkın kaldı. |
| `errors.code_expired` | That code has expired. Ask for a fresh one. | Bu kodun süresi doldu. Yeni bir kod iste. |
| `errors.code_locked` | Too many wrong tries. This code is locked, so ask for a new one. | Çok fazla yanlış deneme. Bu kod kilitlendi, yeni bir kod iste. |
| `errors.code_rate_limited` | Easy there. Wait a few minutes before asking for another code. | Yavaş ol. Yeni kod istemeden önce birkaç dakika bekle. |
| `errors.rate_limited` | Too many tries. Wait a minute and try again. | Çok fazla deneme yaptın. Bir dakika bekle. |
| `errors.email_failed` | We could not send the email right now. Try again in a few minutes. | E-postayı şu an gönderemedik. Birkaç dakika sonra tekrar dene. |
| `errors.session_expired` | You have been signed out. Sign in again to keep playing. | Oturumun kapandı. Oynamaya devam etmek için tekrar giriş yap. |
| `errors.account_banned` | This account is suspended. Think it is a mistake? Email hello@qwakk.fun. | Bu hesap askıya alındı. Hata olduğunu düşünüyorsan hello@qwakk.fun adresine yaz. |
| `errors.account_banned_until` | This account is suspended until {date}. | Bu hesap {date} tarihine kadar askıya alındı. |
| `errors.consent_required` | Tick the first box to continue. It is the only one you have to tick. | Devam etmek için ilk kutuyu işaretle. Zorunlu olan tek kutu bu. |

The existing `unreachable`, `turnstile_failed`, `turnstile_pending` and `generic` errors in `copy.en.ts` and `copy.tr.ts` also cover this flow.

The sign-in and sign-up flow is the same for every email, so the copy never says whether an email already has an account. Keep it that way.

## 4. New account (first sign-in only)

Shown after the code is right and the email has no account yet. Nothing is created until the player presses the button.

| Key | English | Turkish |
| --- | --- | --- |
| `signup.title` | Welcome to the pond | Gölete hoş geldin |
| `signup.sub` | One quick step and your first duck can hatch. | Kısa bir adım kaldı, ilk ördeğin yumurtadan çıkmak üzere. |
| `signup.consent` (checkbox, required, unchecked) | I am 16 or older, I accept the [Terms of Use] and I have read the [Privacy Policy]. | 16 yaşında veya daha büyüğüm, [Kullanım Koşulları]'nı kabul ediyorum ve [Gizlilik Politikası]'nı okudum. |
| `signup.marketing` (checkbox, optional, unchecked) | Yes, email me Qwakk news: new modes, seasons and events. I can unsubscribe any time. | Evet, Qwakk haberlerini (yeni modlar, sezonlar, etkinlikler) e-postayla almak istiyorum. İstediğim zaman vazgeçebilirim. |
| `signup.submit` (button) | Create account | Hesabı oluştur |

Why the consent line says "I have read the Privacy Policy" and not "I accept the Privacy Policy": the account does not run on consent (it runs on the contract), and GDPR and KVKK both treat a privacy notice as information, not something you agree to. Bundling it into an "accept" box can make it look like forced consent. The age and Terms part stays required. The news box must stay separate, unchecked, and never required.

Store with the account: `LEGAL_VERSION`, the acceptance time, the news choice with its time and [[MARKETING_TEXT_VERSION]] (which wording of the news box was shown).

## 5. Updated terms (signed-in player, older `LEGAL_VERSION`)

| Key | English | Turkish |
| --- | --- | --- |
| `legalUpdate.title` | New rules on the pond | Gölette yeni kurallar |
| `legalUpdate.sub` | We updated our Terms of Use and Privacy Policy. Have a look before your next match. | Kullanım Koşulları'nı ve Gizlilik Politikası'nı güncelledik. Sonraki maçından önce bir göz at. |
| `legalUpdate.consent` (checkbox, required) | I accept the updated [Terms of Use] and I have read the [Privacy Policy]. | Güncellenen [Kullanım Koşulları]'nı kabul ediyorum ve [Gizlilik Politikası]'nı okudum. |
| `legalUpdate.submit` (button) | Continue | Devam et |
| `legalUpdate.decline` (link) | I do not accept (account options) | Kabul etmiyorum (hesap seçenekleri) |

## 6. Battle Royale lock for guests

| Key | English | Turkish |
| --- | --- | --- |
| `gate.brButton` | Sign in to play Battle Royale | Battle Royale için giriş yap |
| `gate.brNote` | Guests get Deathmatch. The island is for ducks with an account. | Misafirler Deathmatch oynar. Ada, hesabı olan ördeklere açık. |

## 7. Your ducks (character select)

| Key | English | Turkish |
| --- | --- | --- |
| `ducks.title` | Your ducks | Ördeklerin |
| `ducks.sub` | Up to 4 per account, each with its own name, look and stats. | Hesap başına en fazla 4 ördek, her birinin kendi ismi, görünümü ve istatistikleri var. |
| `ducks.count` | {n}/4 ducks | {n}/4 ördek |
| `ducks.empty` | Empty nest | Boş yuva |
| `ducks.create` (button on an empty slot) | Create duck | Ördek oluştur |
| `ducks.full` | All 4 nests are full. Delete a duck to make room. | 4 yuva da dolu. Yer açmak için bir ördeği sil. |
| `ducks.play` (button) | Play as {name} | {name} ile oyna |
| `ducks.selected` | Selected | Seçili |
| `ducks.switch` (menu button) | Switch duck | Ördek değiştir |
| `ducks.delete` (menu item) | Delete duck | Ördeği sil |

### Create a duck

| Key | English | Turkish |
| --- | --- | --- |
| `create.title` | Name your duck | Ördeğine isim ver |
| `create.nameLabel` | Name | İsim |
| `create.nameHint` | 3 to 16 letters, numbers or _. Keep it friendly: no slurs, no pretending to be someone else. | 3-16 İngilizce harf, rakam veya _. Temiz olsun: hakaret yok, başkası gibi davranmak yok. |
| `create.tagNote` | Your #tag is added for you, like #1234. | Etiketin (#1234 gibi) otomatik eklenir. |
| `create.lookLabel` | Pick a look | Görünüm seç |
| `create.submit` (button) | Hatch it | Yumurtadan çıkar |
| `create.hatching` | Hatching... | Yumurta çatlıyor... |
| `create.done` | {name} has hatched! | {name} yumurtadan çıktı! |

Name errors reuse the existing `name_format`, `name_blocked`, `name_reserved` and `name_full` strings.

### Delete a duck

| Key | English | Turkish |
| --- | --- | --- |
| `deleteDuck.title` | Say goodbye to {name}? | {name} ile vedalaşıyor musun? |
| `deleteDuck.body` | This removes {name} with its level, cosmetics and stats from your account for good. It cannot be undone. | {name}, seviyesi, kozmetikleri ve istatistikleriyle birlikte hesabından kalıcı olarak silinir. Bu işlem geri alınamaz. |
| `deleteDuck.confirmLabel` | Type {name} to confirm | Onaylamak için {name} yaz |
| `deleteDuck.mismatch` | That is not the name. Type it exactly as shown. | İsim eşleşmedi. Tam olarak gösterildiği gibi yaz. |
| `deleteDuck.submit` (danger button, enabled only when the name matches) | Delete {name} | {name} adlı ördeği sil |
| `deleteDuck.cancel` | Keep it | Vazgeç |
| `deleteDuck.done` | {name} has flown away. | {name} uçup gitti. |
| `deleteDuck.inMatch` | Finish or leave your match first. | Önce maçını bitir veya maçtan ayrıl. |

## 8. Account screen

| Key | English | Turkish |
| --- | --- | --- |
| `account.title` | Account | Hesap |
| `account.signedInAs` | Signed in as {email} | {email} ile giriş yapıldı |
| `account.emailLabel` | Email | E-posta |
| `account.emailNote` | Your sign-in codes go here. | Giriş kodların bu adrese gelir. |
| `account.newsLabel` (toggle) | Qwakk news by email | E-postayla Qwakk haberleri |
| `account.newsNote` | New modes, seasons and events. Switch it off any time. | Yeni modlar, sezonlar ve etkinlikler. İstediğin zaman kapatabilirsin. |
| `account.newsOn` | You are on the list. | Listedesin. |
| `account.newsOff` | You are off the list. We will only email you sign-in codes and important account notices. | Listeden çıktın. Sana sadece giriş kodları ve önemli hesap bildirimleri göndereceğiz. |
| `account.dataNote` | Want a copy of your data? Email hello@qwakk.fun from this address. | Verilerinin bir kopyasını mı istiyorsun? Bu adresten hello@qwakk.fun adresine yaz. |
| `account.legal` | Terms of Use · Privacy Policy · Storage notice | Kullanım Koşulları · Gizlilik Politikası · Depolama bildirimi |
| `account.logout` (button) | Log out | Çıkış yap |
| `account.loggedOut` | Logged out. Your ducks are safe and waiting. | Çıkış yaptın. Ördeklerin güvende, seni bekliyor. |
| `account.welcomeBack` | Welcome back, {name}! | Tekrar hoş geldin, {name}! |
| `account.signIn` (menu chip for guests) | Sign in | Giriş yap |

### Delete the account

| Key | English | Turkish |
| --- | --- | --- |
| `deleteAccount.heading` | Danger zone | Tehlikeli bölge |
| `deleteAccount.note` | Removes your email, all your ducks, their progress and cosmetics. | E-postanı, tüm ördeklerini, ilerlemelerini ve kozmetiklerini siler. |
| `deleteAccount.open` (danger link) | Delete my account | Hesabımı sil |
| `deleteAccount.title` | Leaving the pond? | Göletten ayrılıyor musun? |
| `deleteAccount.body` | This deletes your account and all {n} ducks for good. Past matches stay in the history without your names. It cannot be undone. | Hesabın ve {n} ördeğinin hepsi kalıcı olarak silinir. Geçmiş maçlar isimlerin olmadan kayıtlarda kalır. Bu işlem geri alınamaz. |
| `deleteAccount.confirmLabel` | Type DELETE to confirm | Onaylamak için SİL yaz |
| `deleteAccount.mismatch` | Type DELETE in capital letters. | Büyük harflerle SİL yaz. |
| `deleteAccount.submit` (danger button, enabled only on a match) | Delete forever | Kalıcı olarak sil |
| `deleteAccount.cancel` | Keep my account | Hesabım kalsın |
| `deleteAccount.done` | Your account is gone. Thanks for every quack. | Hesabın silindi. Her vak için teşekkürler. |
| `deleteAccount.inMatch` | Finish or leave your match before deleting your account. | Hesabını silmeden önce maçını bitir veya maçtan ayrıl. |

The confirm word follows the menu language: DELETE in English, SİL in Turkish. Compare it after uppercasing in the same locale (`toLocaleUpperCase('tr')` for Turkish, because of the dotted İ).

## 9. Emails

Sender: `Qwakk <noreply@qwakk.fun>`. Send the email in the language of the menu the player used. Never put anything but the code and these lines in it.

### Sign-in code

**Subject**

- EN: `Your Qwakk code: 123456`
- TR: `Qwakk kodun: 123456`

**Plain text, English**

```
Your Qwakk code: 123456

Type it in the game to sign in. It works once, for 10 minutes.

Did not ask for this? Just ignore this email. Nothing happens without the code.

Qwakk will never ask you for this code in chat, by email or by message. Keep it to yourself.

play.qwakk.fun
You got this email because this address was entered at play.qwakk.fun.
Questions: hello@qwakk.fun (this address does not read replies)
```

**Plain text, Turkish**

```
Qwakk kodun: 123456

Giriş yapmak için oyuna yaz. Kod tek kullanımlık ve 10 dakika geçerli.

Bu kodu sen istemedin mi? Bu e-postayı görmezden gel. Kod olmadan hiçbir şey olmaz.

Qwakk bu kodu sohbette, e-postayla veya mesajla asla istemez. Kimseyle paylaşma.

play.qwakk.fun
Bu e-postayı, bu adres play.qwakk.fun'da girildiği için aldın.
Sorular: hello@qwakk.fun (bu adres yanıtları okumaz)
```

**HTML body text** (same order; the code in large type, no images needed, no tracking pixels and no tracked links)

| Part | English | Turkish |
| --- | --- | --- |
| Preheader | Your sign-in code is inside. Valid for 10 minutes. | Giriş kodun içeride. 10 dakika geçerli. |
| Heading | Your Qwakk code | Qwakk kodun |
| Code | 123456 | 123456 |
| Line 1 | Type it in the game to sign in. It works once, for 10 minutes. | Giriş yapmak için oyuna yaz. Kod tek kullanımlık ve 10 dakika geçerli. |
| Line 2 | Did not ask for this? Just ignore this email. Nothing happens without the code. | Bu kodu sen istemedin mi? Bu e-postayı görmezden gel. Kod olmadan hiçbir şey olmaz. |
| Line 3 | Qwakk will never ask you for this code. Keep it to yourself. | Qwakk bu kodu asla istemez. Kimseyle paylaşma. |
| Footer | You got this email because this address was entered at play.qwakk.fun. Questions: hello@qwakk.fun | Bu e-postayı, bu adres play.qwakk.fun'da girildiği için aldın. Sorular: hello@qwakk.fun |

### Account deleted (optional, recommended)

| Part | English | Turkish |
| --- | --- | --- |
| Subject | Your Qwakk account is deleted | Qwakk hesabın silindi |
| Body | Your Qwakk account and its ducks are deleted, as you asked. If this was not you, write to hello@qwakk.fun right away. | Qwakk hesabın ve ördeklerin isteğin üzerine silindi. Bunu sen yapmadıysan hemen hello@qwakk.fun adresine yaz. |

### News emails (later)

Every news email needs a one-click unsubscribe link with this label: EN `Unsubscribe`, TR `Abonelikten çık`, and a footer line: EN `You get this because you asked for Qwakk news. Unsubscribe any time.` TR `Qwakk haberlerini istediğin için bu e-postayı alıyorsun. İstediğin zaman abonelikten çıkabilirsin.`

## 10. Footer links

| Key | English | Turkish |
| --- | --- | --- |
| `footer.terms` | Terms | Koşullar |
| `footer.privacy` | Privacy | Gizlilik |
| `footer.storage` | Storage | Depolama |

The storage notice banner text is in `cookies.md` (section "The notice banner").
