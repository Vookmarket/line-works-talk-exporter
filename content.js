/**
 * LINE WORKS Talk Exporter Content Script
 * ページ内のDOMからメッセージ情報を抽出し、整形して返す
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractTalk") {
    try {
      const extractor = new MessageExtractor();
      const messages = extractor.extract();
      
      if (messages.length === 0) {
        console.warn("No messages found via standard extraction.");
      }

      const formattedText = formatMessages(messages);
      sendResponse({ success: true, data: formattedText, count: messages.length });
    } catch (error) {
      console.error("Extraction error:", error);
      sendResponse({ success: false, error: error.message });
    }
  }
  return true;
});

/**
 * メッセージ抽出ロジックを管理するクラス
 */
class MessageExtractor {
  constructor() {
    this.lastSpeaker = "不明";
    this.lastIsMyMessage = false;
  }

  /**
   * DOMからメッセージを抽出するメインメソッド
   */
  extract() {
    const container = this.findMessageContainer();
    if (!container) return [];

    console.log("Message container found:", container);

    const items = container.children;
    if (!items || items.length === 0) return [];

    const results = [];
    Array.from(items).forEach(item => {
        if (item.style.display === 'none') return;
        
        const parsed = this.parseItem(item);
        if (parsed) {
            results.push(parsed);
        }
    });

    return results;
  }

  /**
   * メッセージリストのコンテナ要素を探す
   */
  findMessageContainer() {
    const container = document.querySelector('.chat_view');
    if (container) return container;
    
    const scrollArea = document.querySelector('#chat_room_scroll');
    if (scrollArea) {
        return scrollArea.firstElementChild || scrollArea;
    }
    
    return document.querySelector('#messageList') || document.body;
  }

  /**
   * 個々のメッセージ要素を解析してデータを抽出する
   */
  parseItem(item) {
    const classList = item.classList;

    if (classList.contains('inform_date')) {
        const dateEl = item.querySelector('.date');
        if (dateEl) {
            return { type: 'date', content: dateEl.innerText.trim() };
        }
    }

    if (classList.contains('inform_msg')) {
        return { type: 'system', content: item.innerText.trim() };
    }

    if (classList.contains('msg_wrap') || classList.contains('msg_rgt') || classList.contains('msg_lft')) {
        return this.parseUserMessage(item);
    }

    return null;
  }

  /**
   * ユーザーメッセージの解析
   */
  parseUserMessage(item) {
    let speaker = null;
    let time = "";
    
    // 1. 時間と話者の取得 (data-for-copy)
    // エスケープ文字が含まれている場合があるので置換してからパース
    let dataStr = item.getAttribute('data-for-copy');
    if (dataStr) {
        try {
            dataStr = dataStr.replace(/"/g, '"');
            const data = JSON.parse(dataStr);
            if (data.fromUserName) speaker = data.fromUserName;
            if (data.messageTime) {
                const date = new Date(data.messageTime);
                time = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
            }
        } catch (e) {
            console.warn("Failed to parse data-for-copy", e);
        }
    }

    // 時間のフォールバック (DOM)
    if (!time) {
        const dateEl = item.querySelector('.date');
        if (dateEl) time = dateEl.innerText.trim();
    }

    // 2. 話者特定ロジック
    // data-for-copy で名前が取れていない場合のみ、DOM/クラス判定を行う
    // これにより、data-for-copyで正しい名前が取れているのに「自分」と上書きされるのを防ぐ
    if (!speaker) {
        // A. 自分のメッセージ判定
        const isRight = item.classList.contains('msg_rgt') || item.classList.contains('my');
        
        let hasIcoMe = false;
        const icoMe = item.querySelector('.ico_me');
        if (icoMe && !icoMe.closest('.msg_box')) {
            hasIcoMe = true;
        }

        if (isRight || hasIcoMe) {
            speaker = "自分";
        }
        // B. 相手のメッセージ判定
        else {
            const dts = item.querySelectorAll('dt');
            
            for (const dt of dts) {
                // 引用内のdtは無視 (.msg_box, .reply_box, .reply_msg)
                if (dt.closest('.msg_box') || dt.closest('.reply_box') || dt.closest('.reply_msg')) continue;

                const nameEl = dt.querySelector('.name');
                if (nameEl) {
                    speaker = nameEl.innerText.trim();
                    break;
                }
            }
        }
    }

    // 3. 最終的な話者決定
    const isRight = item.classList.contains('msg_rgt') || item.classList.contains('my');
    
    if (!speaker) {
        // もし今回が「相手」のメッセージ(msg_lft)で、前回が「自分」だった場合、
        // 名前が特定できない連続投稿風だが、話者は切り替わっているはずなので
        // lastSpeaker("自分")を引き継がず、暫定的に"相手"とする
        if (!isRight && this.lastIsMyMessage) {
             speaker = "相手";
        } else {
             // 連続投稿とみなして直前の話者を使用
             speaker = this.lastSpeaker;
        }
    }

    // 最終的な話者を保存
    // 今回が「自分」判定(isRight)なら、speaker変数が何であれ（本名であれ）、次回への引き継ぎ用に記録
    this.lastIsMyMessage = isRight;
    this.lastSpeaker = speaker || "不明";

    // メッセージ本文の取得
    let message = "";
    
    const textEl = item.querySelector('.msg');
    if (textEl) {
        const clone = textEl.cloneNode(true);
        
        const removeSelectors = [
            '.tit_note', 
            '.reply_area', 
            '.quote_area', 
            '.src_message', 
            '.reply-source',
            '.forward-header',
            '.connect',
            '.desc'
        ];
        
        removeSelectors.forEach(sel => {
            const els = clone.querySelectorAll(sel);
            els.forEach(el => el.remove());
        });

        message = clone.innerText.trim();
    }
    else if (item.querySelector('.sticker_box')) {
        message = "(スタンプ)";
    }
    else if (item.querySelector('.file_name')) {
        const fileName = item.querySelector('.file_name').innerText.trim();
        message = `(ファイル: ${fileName})`;
    }
    else if (item.querySelector('.thmb') || item.querySelector('img')) {
        message = "(画像/メディア)";
    }

    if (!message && !item.innerText.trim()) return null;
    
    if (!message) {
        message = item.innerText.replace(speaker, '').replace(time, '').trim();
    }

    return { type: 'message', speaker, message, time };
  }
}

/**
 * メッセージリストをテキスト形式に整形する
 */
function formatMessages(messages) {
  const header = `LINE WORKS トーク履歴\n出力日時: ${new Date().toLocaleString()}\n` +
                 `==================================================\n\n`;

  const body = messages.map(m => {
    if (m.type === 'date') {
        return `\n---------------- ${m.content} ----------------`;
    }
    if (m.type === 'system') {
        return `[システム] ${m.content}`;
    }
    
    const timeStr = m.time ? ` (${m.time})` : "";
    return `${m.speaker}${timeStr}:\n「${m.message}」`;
  }).join('\n\n');

  return header + body;
}
