/**
 * The account emails (docs/legal/ui-copy.md section 9), in the menu's
 * language: plain text plus a simple branded HTML part. The code is in the
 * body only, never in the subject (lock screens and inbox lists show subjects).
 * No images, no tracking pixel, no tracked links.
 */
import type { CodePurpose } from './codes.ts';

export type MailLang = 'en' | 'tr';

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

export function mailLang(raw: unknown): MailLang {
  return raw === 'tr' ? 'tr' : 'en';
}

const BRAND = { yellow: '#ffd43b', orange: '#ff8a3d', dark: '#151619', ink: '#f4f1e8', muted: '#a8a59c' };

const T = {
  en: {
    subject: { login: 'Your Qwakk sign-in code', delete: 'Your Qwakk account deletion code' },
    preheader: { login: 'Your sign-in code is inside. Valid for 10 minutes.', delete: 'Your code to delete your account is inside. Valid for 10 minutes.' },
    heading: 'Your Qwakk code',
    line1: {
      login: 'Type it in the game to sign in. It works once, for 10 minutes.',
      delete: 'Type it in the game to confirm that you want to delete your account. It works once, for 10 minutes.',
    },
    line2: { login: 'Did not ask for this? Just ignore this email. Nothing happens without the code.', delete: 'Did not ask for this? Just ignore this email. Your account stays as it is without the code.' },
    line3: 'Qwakk will never ask you for this code in chat, by email or by message. Keep it to yourself.',
    footer: 'You got this email because this address was entered at play.qwakk.fun.',
    questions: 'Questions: hello@qwakk.fun (this address does not read replies)',
    deletedSubject: 'Your Qwakk account is deleted',
    deletedBody: 'Your Qwakk account and its ducks are deleted, as you asked. If this was not you, write to hello@qwakk.fun right away.',
  },
  tr: {
    subject: { login: 'Qwakk giriş kodun', delete: 'Qwakk hesap silme kodun' },
    preheader: { login: 'Giriş kodun içeride. 10 dakika geçerli.', delete: 'Hesabını silme kodun içeride. 10 dakika geçerli.' },
    heading: 'Qwakk kodun',
    line1: {
      login: 'Giriş yapmak için oyuna yaz. Kod tek kullanımlık ve 10 dakika geçerli.',
      delete: 'Hesabını silmek istediğini onaylamak için oyuna yaz. Kod tek kullanımlık ve 10 dakika geçerli.',
    },
    line2: { login: 'Bu kodu sen istemedin mi? Bu e-postayı görmezden gel. Kod olmadan hiçbir şey olmaz.', delete: 'Bu kodu sen istemedin mi? Bu e-postayı görmezden gel. Kod olmadan hesabın olduğu gibi kalır.' },
    line3: 'Qwakk bu kodu sohbette, e-postayla veya mesajla asla istemez. Kimseyle paylaşma.',
    footer: "Bu e-postayı, bu adres play.qwakk.fun'da girildiği için aldın.",
    questions: 'Sorular: hello@qwakk.fun (bu adres yanıtları okumaz)',
    deletedSubject: 'Qwakk hesabın silindi',
    deletedBody: 'Qwakk hesabın ve ördeklerin isteğin üzerine silindi. Bunu sen yapmadıysan hemen hello@qwakk.fun adresine yaz.',
  },
} as const;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(lang: MailLang, preheader: string, inner: string): string {
  const t = T[lang];
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Qwakk</title></head>
<body style="margin:0;padding:0;background:${BRAND.dark};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.dark};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1d1f24;border-radius:16px;border:1px solid #2a2d34;">
<tr><td style="padding:28px 28px 8px 28px;font-family:Geist,Segoe UI,Helvetica,Arial,sans-serif;">
<div style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${BRAND.yellow};">Qwakk</div>
</td></tr>
${inner}
<tr><td style="padding:20px 28px 28px 28px;font-family:Geist,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${BRAND.muted};border-top:1px solid #2a2d34;">
play.qwakk.fun<br>${esc(t.footer)}<br>${esc(t.questions)}
</td></tr></table></td></tr></table></body></html>`;
}

/** The email with a sign-in (or account deletion) code. */
export function codeMail(code: string, lang: MailLang, purpose: CodePurpose): MailContent {
  const t = T[lang];
  const text = [
    `${t.heading}: ${code}`,
    '',
    t.line1[purpose],
    '',
    t.line2[purpose],
    '',
    t.line3,
    '',
    'play.qwakk.fun',
    t.footer,
    t.questions,
    '',
  ].join('\n');
  const p = (s: string, extra = '') => `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND.ink};${extra}">${esc(s)}</p>`;
  const inner = `<tr><td style="padding:8px 28px 8px 28px;font-family:Geist,Segoe UI,Helvetica,Arial,sans-serif;">
<h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;color:${BRAND.ink};">${esc(t.heading)}</h1>
<div style="margin:0 0 20px 0;padding:16px 0;text-align:center;background:${BRAND.dark};border-radius:12px;border:1px solid ${BRAND.yellow};">
<span style="font-family:'Geist Mono',SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:0.3em;color:${BRAND.yellow};">${esc(code)}</span>
</div>
${p(t.line1[purpose])}${p(t.line2[purpose])}${p(t.line3, `color:${BRAND.orange};`)}
</td></tr>`;
  return { subject: t.subject[purpose], text, html: page(lang, t.preheader[purpose], inner) };
}

/** The note after an account was deleted. */
export function deletedMail(lang: MailLang): MailContent {
  const t = T[lang];
  const inner = `<tr><td style="padding:8px 28px 8px 28px;font-family:Geist,Segoe UI,Helvetica,Arial,sans-serif;">
<h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;color:${BRAND.ink};">${esc(t.deletedSubject)}</h1>
<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND.ink};">${esc(t.deletedBody)}</p>
</td></tr>`;
  return { subject: t.deletedSubject, text: `${t.deletedBody}\n\nplay.qwakk.fun\n${t.questions}\n`, html: page(lang, t.deletedBody, inner) };
}
