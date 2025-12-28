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

    console.log("Message container found:", container);

    // .chat_view の直下の要素を取得（日付区切りやシステムメッセージも含む）
    // 提供されたHTML構造: .chat_view > div.inform_date, div.msg_wrap ...
    const items = container.children;
    if (!items || items.length === 0) return [];

    const results = [];
    Array.from(items).forEach(item => {
        // 非表示要素はスキップ
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
    // 提供されたHTMLに基づき、右側のチャットエリア(.chat_view)を特定
    const container = document.querySelector('.chat_view');
    if (container) return container;
    
    // フォールバック: スクロールエリア
    const scrollArea = document.querySelector('#chat_room_scroll');
    if (scrollArea) {
        // スクロールエリア内の最初のdivをコンテナとみなすことが多い
        return scrollArea.firstElementChild || scrollArea;
    }
    
    // それでも見つからない場合
    return document.querySelector('#messageList') || document.body;
  }

  /**
   * 個々のメッセージ要素を解析してデータを抽出する
   */
  parseItem(item) {
    const classList = item.classList;

    // 1. 日付区切り線 (例: 2023. 8. 11. (金))
    if (classList.contains('inform_date')) {
        const dateEl = item.querySelector('.date');
        if (dateEl) {
            return { type: 'date', content: dateEl.innerText.trim() };
        }
    }

    // 2. システムメッセージ (例: このトークルームは自分にのみ...)
    if (classList.contains('inform_msg')) {
        return { type: 'system', content: item.innerText.trim() };
    }

    // 3. 通常のメッセージ (msg_wrap)
    if (classList.contains('msg_wrap') || classList.contains('msg_rgt') || classList.contains('msg_lft')) {
        return this.parseUserMessage(item);
    }

    return null;
  }

  /**
   * ユーザーメッセージの解析
   */
  parseUserMessage(item) {
    let speaker = "不明";
    let time = "";
    
    // data-for-copy属性からメタデータを取得（最も確実）
    // 例: data-for-copy='{"fromUserName":"金月弘樹","messageTime":1700659279874,...}'
    const dataStr = item.getAttribute('data-for-copy');
    if (dataStr) {
        try {
            const data = JSON.parse(dataStr);
            speaker = data.fromUserName || "自分";
            if (data.messageTime) {
                const date = new Date(data.messageTime);
                time = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
            }
        } catch (e) {
            console.warn("Failed to parse data-for-copy", e);
        }
    } else {
        // フォールバック: DOMから探す
        // リプライ等の引用内にある名前を拾わないよう、dtタグ直下の名前のみを探す
        const nameEl = item.querySelector('dt .name');
        if (nameEl) speaker = nameEl.innerText.trim();
        
        const dateEl = item.querySelector('.date'); // 時間表示
        if (dateEl) time = dateEl.innerText.trim();
    }

    // もしスピーカーが不明で、クラスに 'my' や 'ico_me' があれば自分
    if (speaker === "不明") {
        // .ico_me も引用内にある可能性を排除するため、dt内のみ探すか、厳密にチェック
        const hasIcoMe = item.querySelector('dt .ico_me') !== null || item.querySelector('.ico_me') !== null;
        
        if (item.classList.contains('my') || hasIcoMe) {
            // ここで hasIcoMe が引用内のものを拾っている可能性があるため、
            // item自体が 'my' クラスを持っているかを重視する。
            // DOM構造上、自分のメッセージは item.classList.contains('my') ではない場合もある（HTML例では ico_me がある）
            
            // 安全策: dtの中に ico_me がある場合のみ自分とする
            if (item.classList.contains('my') || item.querySelector('dt .ico_me')) {
                speaker = "自分";
            } else if (item.querySelector('.ico_me')) {
                // dt外だがico_meがある場合... 引用内の可能性が高いので無視する
                // 何もしない（speakerは不明のまま -> lastSpeakerへ）
            } 
        } 
        
        if (speaker === "不明") {
             // 連続投稿の場合、直前の話者を使う
             speaker = this.lastSpeaker;
        }
    }
    this.lastSpeaker = speaker;

    // メッセージ本文の取得
    let message = "";
    
    // テキストメッセージ
    const textEl = item.querySelector('.msg');
    if (textEl) {
        // リプライ元や転送ヘッダーを除外するためにクローンを作成
        const clone = textEl.cloneNode(true);
        
        // 削除対象のセレクタ（リプライ元や転送情報）
        // .tit_note: 転送メッセージのヘッダー
        // .reply-area, .quote-area: 一般的なリプライ元のクラス（推測含む）
        // .connect: リプライ元の引用やリンクカード
        // .desc: 「トークの詳細」などのリンクテキスト
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
    // スタンプ
    else if (item.querySelector('.sticker_box')) {
        message = "(スタンプ)";
    }
    // ファイル添付
    else if (item.querySelector('.file_name')) {
        const fileName = item.querySelector('.file_name').innerText.trim();
        message = `(ファイル: ${fileName})`;
    }
    // 画像添付
    else if (item.querySelector('.thmb') || item.querySelector('img')) {
        message = "(画像/メディア)";
    }

    if (!message && !item.innerText.trim()) return null;
    
    // メッセージが空でも、添付ファイルなどがあるかもしれないので、
    // 上記のチェックで見つからなければ、全体のテキストを返す（最後の手段）
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
    
    // 通常メッセージ
    const timeStr = m.time ? ` (${m.time})` : "";
    return `${m.speaker}${timeStr}:\n「${m.message}」`;
  }).join('\n\n');

  return header + body;
}
