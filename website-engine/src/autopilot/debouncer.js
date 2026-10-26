/**
 * Debounces and batches rapid incoming messages from WhatsApp groups in Full Auto mode.
 */

const DEBOUNCE_WINDOW_MS = 3500; // 3.5 seconds

class FullAutoDebouncer {
  constructor() {
    this.pendingBatches = new Map(); // groupJid -> { timer, messages: [], lastMsg, sock }
  }

  queue({ groupJid, text, msg, sock, onBatchReady }) {
    if (!this.pendingBatches.has(groupJid)) {
      this.pendingBatches.set(groupJid, {
        timer: null,
        texts: [],
        lastMsg: msg,
        sock,
      });
    }

    const batch = this.pendingBatches.get(groupJid);
    if (text) {
      batch.texts.push(text.trim());
    }
    batch.lastMsg = msg;
    batch.sock = sock;

    if (batch.timer) {
      clearTimeout(batch.timer);
    }

    batch.timer = setTimeout(() => {
      this.pendingBatches.delete(groupJid);
      const combinedText = batch.texts.join('\n');
      onBatchReady({
        groupJid,
        combinedText,
        lastMsg: batch.lastMsg,
        sock: batch.sock,
      });
    }, DEBOUNCE_WINDOW_MS);
  }

  cancel(groupJid) {
    if (this.pendingBatches.has(groupJid)) {
      const batch = this.pendingBatches.get(groupJid);
      if (batch.timer) clearTimeout(batch.timer);
      this.pendingBatches.delete(groupJid);
    }
  }
}

export const fullAutoDebouncer = new FullAutoDebouncer();
