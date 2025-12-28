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
    this.lastIsMe = false;
    this.roomTitle = "相手";
  }

  /**
   * DOMからメッセージを抽出するメインメソッド
   */
  extract() {
    const container = this.findMessageContainer();
    if (!container) return [];

    // トークルーム名（相手の名前）を取得
    this.getRoomTitle();
    console.log("Message container found:", container);
    console.log("Room title:", this.roomTitle);

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

  getRoomTitle() {
      // ヘッダーから名前を取得
      // 提供されたHTML: .section_head .info_box .name
      const titleSelectors = [
          '.section_head .info_box .name',
          '.header .title', 
          'header .tit',
          '#header .name'
      ];
      
      for (const sel of titleSelectors) {
          const el = document.querySelector(sel);
          if (el) {
              this.roomTitle = el.innerText.trim();
              break;
          }
      }
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
    
    // 時間の取得 (data-for-copy利用)
    const dataStr = item.getAttribute('data-for-copy');
    if (dataStr) {
        try {
            const data = JSON.parse(dataStr.replace(/"/g, '"'));
            if (data.messageTime) {
                const date = new Date(data.messageTime);
                time = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
            }
        } catch (e) {}
    }
    if (!time) {
        const dateEl = item.querySelector('.date');
        if (dateEl) time = dateEl.innerText.trim();
    }

    // 話者の特定 (DOMのクラス/表示位置による判定を絶対とする)
    
    // 1. 自分か相手か (表示位置で判定)
    let isMe = item.classList.contains('msg_rgt') || item.classList.contains('my');
    
    // クラス判定で「自分」でない場合でも、座標的に右側にあれば「自分」とみなす（クラス漏れ対策）
    if (!isMe) {
        const contentEl = item.querySelector('.msg_box') || item;
        const rect = contentEl.getBoundingClientRect();
        // 左端からウィンドウ幅の30%以上離れていれば右寄せ（自分）と判定
        if (rect.left > (window.innerWidth * 0.3)) {
            isMe = true;
        }
    }
    
    if (isMe) {
        speaker = "自分";
    } else {
        // 2. 相手の場合 (msg_lft)
        // 名前ヘッダー(dt)を探す
        const dts = item.querySelectorAll('dt');
        for (const dt of dts) {
            // 引用内(.msg_box)のdtは無視
            if (dt.closest('.msg_box') || dt.closest('.reply_box') || dt.closest('.reply_msg')) continue;
            
            const nameEl = dt.querySelector('.name');
            if (nameEl) {
                speaker = nameEl.innerText.trim();
                break;
            }
        }
        
        // 名前が見つからない場合
        if (!speaker) {
            // 直前が自分だった場合、あるいは初回でlastSpeakerが不明の場合
            // -> 個人チャットの可能性が高いので「トークルーム名（相手の名前）」を使用
            if (this.lastIsMe || this.lastSpeaker === "不明") {
                speaker = this.roomTitle;
            } else {
                // 相手の連続投稿なら名前を引き継ぐ
                speaker = this.lastSpeaker;
            }
        }
    }
    
    // 状態更新
    this.lastIsMe = isMe;
    this.lastSpeaker = speaker;

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
