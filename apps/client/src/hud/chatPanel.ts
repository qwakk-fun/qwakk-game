import { CHAT } from '@qwakk/shared';
import type { ChatMessage } from '@qwakk/shared/net';
import { t } from '../i18n/game.ts';
import type { Controls } from '../input/controls.ts';
import './chat.css';

/** Room chat uses text nodes throughout, including player names and message bodies. */
export class ChatPanel {
  private readonly root = document.createElement('section');
  private readonly log = document.createElement('div');
  private readonly toggle = document.createElement('button');
  private readonly form = document.createElement('form');
  private readonly input = document.createElement('input');
  private readonly hint = document.createElement('div');
  private readonly abort = new AbortController();
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private nextSend = 0;
  private opened = false;

  constructor(parent: HTMLElement, controls: Controls, send: (text: string) => void, beforeOpen: () => boolean) {
    this.controls = controls;
    this.root.className = 'game-chat quiet';
    this.root.setAttribute('aria-label', t('Room chat'));
    this.log.className = 'chat-log tc-scroll';
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'polite');
    this.log.setAttribute('aria-relevant', 'additions');
    this.toggle.type = 'button';
    this.toggle.className = 'chat-toggle';
    this.toggle.textContent = t('T · Chat');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.form.className = 'chat-compose';
    this.form.hidden = true;
    this.input.type = 'text';
    this.input.maxLength = CHAT.maxLength;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = t('Say something...');
    this.input.setAttribute('aria-label', t('Message to the room'));
    this.input.enterKeyHint = 'send';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = t('Send');
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', t('Close chat'));
    this.form.append(this.input, submit, close);
    this.hint.className = 'chat-hint';
    this.hint.hidden = true;
    this.hint.setAttribute('role', 'status');
    this.root.append(this.log, this.toggle, this.form, this.hint);
    parent.append(this.root);

    const opts = { signal: this.abort.signal };
    this.toggle.addEventListener('click', () => this.open(), opts);
    close.addEventListener('click', () => this.close(), opts);
    this.beforeOpen = beforeOpen;
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return this.close();
      if (performance.now() < this.nextSend) return this.limited();
      this.nextSend = performance.now() + CHAT.intervalMs;
      send(text);
      this.input.value = '';
      this.close();
    }, opts);
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) {
        if (e.key === 'Enter') e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    }, opts);
    // Pointer lock can change asynchronously after an opening click.
    document.addEventListener('pointerlockchange', () => {
      if (this.opened && !document.pointerLockElement) this.input.focus();
      else if (this.opened) this.close(false);
    }, opts);
  }

  private readonly controls: Controls;
  private readonly beforeOpen: () => boolean;

  get isOpen(): boolean { return this.opened; }

  open(): void {
    if (this.opened || !this.beforeOpen()) return;
    this.opened = true;
    this.controls.setTyping(true);
    document.body.classList.add('chat-open');
    this.root.classList.add('open');
    this.toggle.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'true');
    this.form.hidden = this.hint.hidden = false;
    this.hint.textContent = t('Enter to send · Esc to close');
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.focus();
    this.log.scrollTop = this.log.scrollHeight;
  }

  close(relock = true): void {
    if (!this.opened) return;
    this.opened = false;
    this.controls.setTyping(false);
    document.body.classList.remove('chat-open');
    this.root.classList.remove('open');
    this.toggle.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'false');
    this.form.hidden = this.hint.hidden = true;
    this.input.blur();
    if (relock) this.controls.requestLock();
  }

  receive(message: ChatMessage, own: boolean): void {
    const row = document.createElement('div');
    row.className = 'chat-message';
    const name = document.createElement('b');
    name.className = own ? 'chat-self' : 'chat-name';
    name.textContent = `${message.name}${message.tag ? `#${message.tag}` : ''}`;
    const text = document.createElement('span');
    text.textContent = message.text;
    text.dir = 'auto';
    row.append(name, document.createTextNode(': '), text);
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
    this.log.append(row);
    while (this.log.childElementCount > CHAT.historySize) this.log.firstElementChild?.remove();
    if (!this.opened || atBottom) this.log.scrollTop = this.log.scrollHeight;
    this.root.classList.remove('quiet');
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => this.root.classList.add('quiet'), CHAT.visibleMs);
  }

  limited(): void {
    if (!this.opened) this.open();
    this.hint.textContent = t('Wait a moment before sending another message.');
  }

  dispose(): void {
    this.close(false);
    this.abort.abort();
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.root.remove();
  }
}
