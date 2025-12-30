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
      sendResponse({ success: true, data: formattedText, rawData: messages, count: messages.length });
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
    
    // 時間と話者の取得 (data-for-copy利用)
    // グループトーク対応のため、data-for-copyの名前を最優先する
    const dataStr = item.getAttribute('data-for-copy');
    if (dataStr) {
        try {
            const data = JSON.parse(dataStr.replace(/"/g, '"'));
            if (data.fromUserName) speaker = data.fromUserName;
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

    // 1. 自分か相手か (クラスおよび内部要素で判定)
    let isMe = item.classList.contains('msg_rgt') || item.classList.contains('my');
    if (!isMe) {
        if (item.querySelector('.read')) {
            isMe = true;
        }
    }
    
    // 2. 話者が未特定の場合のフォールバック (DOM探索)
    if (!speaker) {
        if (isMe) {
            speaker = "自分";
        } else {
            // 相手の場合 (msg_lft)
            // 名前ヘッダー(.name)を探す
            // dtタグに限定せず、.msg_box外の.nameを探す (em.nameなどのパターンに対応)
            const nameEls = item.querySelectorAll('.name');
            for (const el of nameEls) {
                // 引用内(.msg_box)の要素は無視
                if (el.closest('.msg_box') || el.closest('.reply_box') || el.closest('.reply_msg')) continue;
                
                speaker = el.innerText.trim();
                break;
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
    }
    
    // 状態更新
    this.lastIsMe = isMe;
    this.lastSpeaker = speaker;

    // メッセージ本文の取得
    let message = "";
    
    // 1. item全体をクローンして、引用部分を物理的に削除する
    const itemClone = item.cloneNode(true);
    
    // 削除すべき引用コンテナ
    const quoteSelectors = [
        '.reply_msg', 
        '.reply_area', 
        '.quote_area'
    ];
    quoteSelectors.forEach(sel => {
        const els = itemClone.querySelectorAll(sel);
        els.forEach(el => el.remove());
    });

    // 2. クリーンになったクローンから本文を探す
    const textEl = itemClone.querySelector('.msg');
    
    if (textEl) {
        // 本文内にある不要な要素（転送ヘッダーなど）を削除
        const removeSelectors = [
            '.tit_note', 
            '.src_message', 
            '.reply-source',
            '.forward-header',
            '.desc'
            // '.connect' は削除しない
        ];
        
        removeSelectors.forEach(sel => {
            const els = textEl.querySelectorAll(sel);
            els.forEach(el => el.remove());
        });

        message = textEl.innerText.trim();
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
