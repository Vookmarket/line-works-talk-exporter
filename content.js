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
  }

  /**
   * DOMからメッセージを抽出するメインメソッド
   */
  extract() {
    const container = this.findMessageContainer();
    if (!container) return [];

    const items = this.findMessageItems(container);
    if (!items || items.length === 0) return [];

    return items.map(item => this.parseItem(item)).filter(msg => msg !== null);
  }

  /**
   * メッセージリストのコンテナ要素を探す
   */
  findMessageContainer() {
    // 優先度の高いセレクタ（右側のチャットエリアと思われるもの）
    const prioritySelectors = [
      '#messageList', 
      '#talk_view_area',
      'ul[class*="chat"]',
      'div[class*="message_list"]',
      'ul[class*="message_list"]',
      '.chat-list',
      '[role="main"]'
    ];

    // まずはIDやクラスで探す
    for (const sel of prioritySelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        // 非表示のものは除外
        if (el.offsetParent === null) continue;
        
        // 幅チェック: トークルーム一覧（左サイドバー）は通常幅が狭い
        // メインエリアはそれより広いはず
        const rect = el.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        
        // ウィンドウの40%以上の幅がある、または400px以上の幅がある要素を対象とする
        // (サイドバーは通常300px程度)
        if (rect.width > 400 || rect.width > (windowWidth * 0.4)) {
           // 要素内にリストアイテムやメッセージっぽいものがあるか確認
           if (el.querySelectorAll('li, div[class*="msg"], div[class*="row"]').length > 0) {
             console.log("Found container by selector:", sel, el);
             return el;
           }
        }
      }
    }

    // セレクタで見つからない場合、ページ内の「メッセージアイテムを多く含む最大のコンテナ」を探す
    // ただし、幅が狭いコンテナ（サイドバー）は除外する
    
    console.log("Fallback: Searching all containers...");
    const candidates = document.querySelectorAll('ul, ol, div[role="list"], section, main, article, div[class*="list"]');
    let bestContainer = null;
    let maxItems = 0;

    candidates.forEach(el => {
        // 非表示チェック
        if (el.offsetParent === null) return;
        
        // 幅チェック
        const rect = el.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        
        // サイドバー除外のための幅チェック
        // ウィンドウ幅の40%以上、または400px以上
        const isWideEnough = rect.width > 400 || rect.width > (windowWidth * 0.4);
        
        if (!isWideEnough) return;

        // アイテム数をカウント
        const items = el.querySelectorAll('li, div[class*="msg-item"], div[class*="message-item"], div[class*="chat-item"]');
        if (items.length > maxItems) {
            maxItems = items.length;
            bestContainer = el;
        }
    });

    if (bestContainer) {
        console.log("Found container by fallback:", bestContainer);
        return bestContainer;
    }

    // どうしても見つからない場合、bodyを返す（以前の挙動に近いが、フィルター付き）
    // ただし、これだとサイドバーも拾ってしまう可能性があるので、最後の手段
    console.warn("No specific container found, returning body.");
    return document.body;
  }

  /**
   * コンテナ内の個々のメッセージ要素を取得する
   */
  findMessageItems(container) {
    // コンテナがbodyの場合、全探索になるので注意が必要
    // その場合でも、幅が狭い親要素を持つアイテムは除外する
    
    let items = container.querySelectorAll('li, div[role="listitem"], .msg_item, .message-item, div[class*="row"]');
    
    // itemsが空の場合、より広範な検索を行う
    if (items.length === 0) {
        items = container.querySelectorAll('div[class*="msg"], div[class*="chat-item"]');
    }
    
    return Array.from(items).filter(item => {
        // 非表示要素やシステムメッセージを除外
        if (item.style.display === 'none') return false;
        
        // アイテム自体の幅チェック（念のため）
        // 親がbodyの場合、サイドバーのアイテムも含まれる可能性があるため
        if (container === document.body) {
            const rect = item.getBoundingClientRect();
            // 左端にあり、かつ幅が狭いものは除外（サイドバーの可能性大）
            if (rect.left < 100 && rect.width < 350) {
                return false;
            }
        }

        const className = (item.className || "").toString();
        if (className.includes('system') || className.includes('date-line') || className.includes('notice')) {
            return false;
        }
        return true;
    });
  }

  /**
   * 個々のメッセージ要素を解析してデータを抽出する
   */
  parseItem(item) {
    // スピーカーの特定
    let speaker = this.identifySpeaker(item);
    
    // 時間の特定
    const time = this.identifyTime(item);

    // メッセージ本文の特定
    const message = this.identifyMessageBody(item);

    if (!message) return null;

    return { speaker, message, time };
  }

  identifySpeaker(item) {
    // 自分のメッセージ判定
    const isMe = item.classList.contains('my') || 
                 item.classList.contains('me') || 
                 item.classList.contains('right') ||
                 item.classList.contains('sent') ||
                 item.querySelector('.my') !== null;

    if (isMe) {
      return "自分";
    }

    // 名前要素の探索
    const nameSelectors = ['.name', '.sender', 'dt', 'strong', '.profile_name', '[class*="name"]', 'h3', 'h4'];
    for (const sel of nameSelectors) {
      const el = item.querySelector(sel);
      if (el && el.innerText.trim()) {
        const name = el.innerText.trim();
        this.lastSpeaker = name;
        return name;
      }
    }

    // 名前がない場合、直前の話者（連続投稿）
    return this.lastSpeaker;
  }

  identifyTime(item) {
    const timeSelectors = ['.time', '.date', '.timestamp', 'span[class*="time"]', 'small', 'div[class*="time"]'];
    for (const sel of timeSelectors) {
      const el = item.querySelector(sel);
      if (el) return el.innerText.trim();
    }
    return "";
  }

  identifyMessageBody(item) {
    const bodySelectors = [
      '.text', '.msg', '.message', '.content', '.speech', '.bubble', 
      'pre', '.msg_text', '[class*="text"]', 'p', 'div[class*="body"]'
    ];

    for (const sel of bodySelectors) {
      const el = item.querySelector(sel);
      if (el) return el.innerText.trim();
    }

    return null;
  }
}

/**
 * メッセージリストをテキスト形式に整形する
 */
function formatMessages(messages) {
  const header = `LINE WORKS トーク履歴\n出力日時: ${new Date().toLocaleString()}\n` +
                 `==================================================\n\n`;

  const body = messages.map(m => {
    // 時間がある場合は表示に追加
    const timeStr = m.time ? ` (${m.time})` : "";
    
    return `${m.speaker}${timeStr}:\n「${m.message}」`;
  }).join('\n\n');

  return header + body;
}
