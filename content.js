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
   * 左側のトークルーム一覧ではなく、右側のメッセージエリアを取得する
   */
  findMessageContainer() {
    // まず、左側のトークルーム一覧を除外するために、メインのメッセージエリアを特定
    // メッセージエリアの候補（トークルーム一覧は除外）
    const messageAreaCandidates = [
      '#messageList',
      '.message-area',
      '.chat-content',
      '.talk-content',
      'main[class*="chat"]',
      'main[class*="talk"]',
      'section[class*="message"]',
      'div[class*="message-area"]',
      'div[class*="chat-body"]',
      'article',
      '[role="main"]'
    ];

    // メッセージエリアを見つける
    let messageArea = null;
    for (const sel of messageAreaCandidates) {
      const el = document.querySelector(sel);
      if (el) {
        // トークルーム一覧を含まないことを確認
        // （一覧は通常、左側に固定されている）
        const rect = el.getBoundingClientRect();
        if (rect.width > 300) { // 一覧より広い要素を優先
          messageArea = el;
          break;
        }
      }
    }

    if (!messageArea) {
      // フォールバック: より広範な探索
      // 画面中央付近（x > 300px）にある要素を探す
      const allContainers = document.querySelectorAll('div, section, main, article');
      let bestContainer = null;
      let maxItems = 0;

      allContainers.forEach(container => {
        const rect = container.getBoundingClientRect();
        // 左端のトークルーム一覧を除外（x座標が300px以上）
        if (rect.x > 250 && rect.width > 300) {
          const itemCount = container.querySelectorAll('li, div[class*="message"], div[class*="msg"]').length;
          if (itemCount > maxItems) {
            maxItems = itemCount;
            bestContainer = container;
          }
        }
      });

      messageArea = bestContainer;
    }

    return messageArea;
  }

  /**
   * コンテナ内の個々のメッセージ要素を取得する
   */
  findMessageItems(container) {
    let items = container.querySelectorAll('li, div[role="listitem"], .msg_item, .message-item');
    
    // itemsが空の場合、より広範な検索を行う
    if (items.length === 0) {
        items = container.querySelectorAll('div[class*="msg"], div[class*="chat-item"]');
    }
    
    return Array.from(items).filter(item => {
        // 非表示要素やシステムメッセージを除外
        if (item.style.display === 'none') return false;
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
    const timeSelectors = ['.time', '.date', '.timestamp', 'span[class*="time"]', 'small'];
    for (const sel of timeSelectors) {
      const el = item.querySelector(sel);
      if (el) return el.innerText.trim();
    }
    return "";
  }

  identifyMessageBody(item) {
    const bodySelectors = [
      '.text', '.msg', '.message', '.content', '.speech', '.bubble', 
      'pre', '.msg_text', '[class*="text"]', 'p'
    ];

    for (const sel of bodySelectors) {
      const el = item.querySelector(sel);
      if (el) return el.innerText.trim();
    }

    // 最終手段: アイテムのテキスト全体から名前と時間を除外して取得を試みる
    // リスクが高いため、ここではnullを返す（空メッセージとして除外される）
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
    
    // フォーマット: {話者名} (12:00):
    //               「{メッセージ}」
    // 読みやすくするために改行を入れる
    return `${m.speaker}${timeStr}:\n「${m.message}」`;
  }).join('\n\n'); // 各メッセージ間に空行を入れる

  return header + body;
}
