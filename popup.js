let currentMessages = [];

document.addEventListener('DOMContentLoaded', () => {
    // 起動時にメッセージを取得して表示
    fetchAndDisplayMessages();

    // 保存ボタンのイベントリスナー
    document.getElementById('exportBtn').addEventListener('click', downloadCurrentMessages);

    // 話者変更ボタンのイベントリスナー
    document.getElementById('updateSpeakerBtn').addEventListener('click', updateSpeakerName);
});

/**
 * メッセージを取得して画面に表示する
 */
async function fetchAndDisplayMessages() {
    const statusDiv = document.getElementById('status');
    const resultContainer = document.getElementById('result-container');
    const editorContainer = document.getElementById('editor-container');
    
    statusDiv.textContent = '読み込み中...';
    statusDiv.style.color = '#666';
    resultContainer.style.display = 'none';
    editorContainer.style.display = 'none';
    resultContainer.innerHTML = '';

    const response = await extractMessages(statusDiv);
    
    if (response && response.success) {
        if (response.count === 0) {
            statusDiv.textContent = '警告: メッセージが見つかりませんでした。DOM構造が変更されている可能性があります。';
            statusDiv.style.color = 'orange';
        } else {
            // データを保持
            currentMessages = response.rawData;

            // 画面表示処理
            renderResults(currentMessages);
            updateSpeakerList();
            
            resultContainer.style.display = 'flex';
            editorContainer.style.display = 'block';
            
            statusDiv.textContent = `完了: ${response.count}件のメッセージを表示しています。`;
            statusDiv.style.color = 'green';
        }
    }
}

/**
 * 現在保持しているメッセージデータをダウンロードする
 */
function downloadCurrentMessages() {
    const statusDiv = document.getElementById('status');
    
    if (!currentMessages || currentMessages.length === 0) {
        statusDiv.textContent = 'エラー: 保存するデータがありません。';
        statusDiv.style.color = 'red';
        return;
    }
    
    statusDiv.textContent = '保存用データを生成中...';
    
    // 現在のデータからテキストを生成
    const formattedText = formatMessagesForDownload(currentMessages);
    
    downloadFile(formattedText, `line_works_talk_${getDateTimeString()}.txt`);
    
    statusDiv.textContent = `保存完了: ${currentMessages.length}件のメッセージを保存しました。`;
    statusDiv.style.color = 'green';
}

/**
 * 話者名を変更する
 */
function updateSpeakerName() {
    const select = document.getElementById('speakerSelect');
    const input = document.getElementById('newSpeakerName');
    const oldName = select.value;
    const newName = input.value.trim();
    
    if (!oldName || !newName) {
        alert('変更する話者と新しい名前を入力してください。');
        return;
    }
    
    let count = 0;
    currentMessages.forEach(msg => {
        if (msg.speaker === oldName) {
            msg.speaker = newName;
            count++;
        }
    });
    
    if (count > 0) {
        renderResults(currentMessages);
        updateSpeakerList(); // リストを更新（選択状態はリセットされる）
        input.value = ''; // 入力をクリア
        
        const statusDiv = document.getElementById('status');
        statusDiv.textContent = `完了: "${oldName}" を "${newName}" に変更しました (${count}件)。`;
        statusDiv.style.color = 'green';
    }
}

/**
 * 話者選択リストを更新する
 */
function updateSpeakerList() {
    const select = document.getElementById('speakerSelect');
    const currentSelection = select.value;
    
    // ユニークな話者を抽出
    const speakers = new Set();
    currentMessages.forEach(msg => {
        if (msg.speaker) {
            speakers.add(msg.speaker);
        }
    });
    
    select.innerHTML = '';
    
    // "自分" を先頭にするなどの配慮があれば良いが、とりあえずアルファベット順または出現順
    Array.from(speakers).sort().forEach(speaker => {
        const option = document.createElement('option');
        option.value = speaker;
        option.textContent = speaker;
        select.appendChild(option);
    });
    
    // 可能なら元の選択を維持、なければ先頭
    if (currentSelection && speakers.has(currentSelection)) {
        select.value = currentSelection;
    }
}

/**
 * 共通のメッセージ取得ロジック
 */
async function extractMessages(statusDiv) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab.url.includes('worksmobile.com')) {
            statusDiv.textContent = '注意: LINE WORKSのページではない可能性があります。';
        }

        try {
            const response = await chrome.tabs.sendMessage(tab.id, { action: "extractTalk" });
            
            if (response && response.success) {
                return response;
            } else {
                statusDiv.textContent = 'エラー: ' + (response ? response.error : '不明なエラー');
                statusDiv.style.color = 'red';
                return null;
            }
        } catch (msgError) {
            console.error(msgError);
            statusDiv.textContent = 'エラー: ページをリロードして再試行してください。';
            statusDiv.style.color = 'red';
            return null;
        }

    } catch (error) {
        console.error(error);
        statusDiv.textContent = 'システムエラー: ' + error.message;
        statusDiv.style.color = 'red';
        return null;
    }
}

function getDateTimeString() {
    const now = new Date();
    return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 結果リストを描画する
 */
function renderResults(messages) {
    const container = document.getElementById('result-container');
    container.innerHTML = '';

    messages.forEach((msg, index) => {
        let el;

        if (msg.type === 'date') {
            el = document.createElement('div');
            el.className = 'date-header-container draggable-item';
            
            const dateText = document.createElement('span');
            dateText.className = 'date-header';
            dateText.textContent = msg.content;
            
            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'この日をコピー';
            copyBtn.className = 'copy-date-btn';
            // ドラッグイベントが発火しないようにクリックイベントを制御
            copyBtn.onmousedown = (e) => e.stopPropagation();
            copyBtn.onclick = () => copyDateMessages(index, copyBtn);
            
            el.appendChild(dateText);
            el.appendChild(copyBtn);
        } else if (msg.type === 'system') {
            el = document.createElement('div');
            el.className = 'system-message draggable-item';
            el.textContent = msg.content;
        } else if (msg.type === 'message') {
            el = document.createElement('div');
            el.className = 'message-item draggable-item';

            const header = document.createElement('div');
            header.className = 'item-header';
            
            const speakerSpan = document.createElement('span');
            speakerSpan.textContent = msg.speaker;
            
            const timeSpan = document.createElement('span');
            timeSpan.textContent = msg.time;
            
            header.appendChild(speakerSpan);
            header.appendChild(timeSpan);

            const content = document.createElement('div');
            content.className = 'message-content';
            content.textContent = msg.message;

            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.textContent = 'コピー';
            // ドラッグイベントが発火しないようにクリックイベントを制御
            copyBtn.onmousedown = (e) => e.stopPropagation();
            copyBtn.onclick = () => copyMessageToClipboard(msg, copyBtn);

            el.appendChild(header);
            el.appendChild(content);
            el.appendChild(copyBtn);
        }

        if (el) {
            // ドラッグ＆ドロップ用属性とイベント設定
            el.setAttribute('draggable', 'true');
            el.dataset.index = index;
            
            el.addEventListener('dragstart', handleDragStart);
            el.addEventListener('dragover', handleDragOver);
            el.addEventListener('dragleave', handleDragLeave);
            el.addEventListener('drop', handleDrop);
            el.addEventListener('dragend', handleDragEnd);

            container.appendChild(el);
        }
    });
}

// ドラッグ＆ドロップ関連の変数
let dragSrcEl = null;

function handleDragStart(e) {
    dragSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    this.style.opacity = '0.4';
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    this.classList.add('over');
    return false;
}

function handleDragLeave(e) {
    this.classList.remove('over');
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    if (dragSrcEl !== this) {
        const fromIndex = parseInt(dragSrcEl.dataset.index);
        const toIndex = parseInt(this.dataset.index);

        // 配列の要素を移動
        const itemToMove = currentMessages[fromIndex];
        currentMessages.splice(fromIndex, 1);
        currentMessages.splice(toIndex, 0, itemToMove);

        // 再描画
        renderResults(currentMessages);
        
        // ステータス更新
        const statusDiv = document.getElementById('status');
        statusDiv.textContent = '順序を変更しました。';
        statusDiv.style.color = 'blue';
        setTimeout(() => {
            if (statusDiv.textContent === '順序を変更しました。') {
                statusDiv.textContent = '';
            }
        }, 2000);
    }

    return false;
}

function handleDragEnd(e) {
    this.style.opacity = '1.0';
    const items = document.querySelectorAll('.draggable-item');
    items.forEach(item => {
        item.classList.remove('over');
    });
}

async function copyMessageToClipboard(msg, btnElement) {
    const timeStr = msg.time ? ` (${msg.time})` : "";
    const textToCopy = `${msg.speaker}${timeStr}:\n「${msg.message}」`;

    try {
        await navigator.clipboard.writeText(textToCopy);
        
        // ボタンの表示を一時的に変更
        const originalText = btnElement.textContent;
        btnElement.textContent = 'コピー完了!';
        btnElement.style.backgroundColor = '#dff0d8';
        btnElement.style.borderColor = '#d6e9c6';
        
        setTimeout(() => {
            btnElement.textContent = originalText;
            btnElement.style.backgroundColor = '';
            btnElement.style.borderColor = '';
        }, 1500);
    } catch (err) {
        console.error('コピーに失敗しました', err);
        btnElement.textContent = 'エラー';
        btnElement.style.color = 'red';
    }
}

/**
 * メッセージリストをテキスト形式に整形する（ダウンロード用）
 * content.jsのformatMessagesと同様のロジック
 */
function formatMessagesForDownload(messages) {
  const header = `LINE WORKS トーク履歴\n出力日時: ${new Date().toLocaleString()}\n` +
                 `==================================================\n\n`;

  const body = messages.map(m => {
    if (m.type === 'date') {
        return `\n---------------- ${m.content} ----------------`;
    }
    if (m.type === 'system') {
        return `[システム] ${m.content}`;
    }
    
    if (m.type === 'message') {
        const timeStr = m.time ? ` (${m.time})` : "";
        return `${m.speaker}${timeStr}:\n「${m.message}」`;
    }
    return '';
  }).join('\n\n');

  return header + body;
}

async function copyDateMessages(startIndex, btnElement) {
    let textToCopy = "";
    
    // ヘッダー情報（日付）を取得
    const dateMsg = currentMessages[startIndex];
    textToCopy += `---------------- ${dateMsg.content} ----------------\n\n`;
    
    // 次のメッセージから探索開始
    for (let i = startIndex + 1; i < currentMessages.length; i++) {
        const msg = currentMessages[i];
        
        // 次の日付ヘッダーに来たら終了
        if (msg.type === 'date') break;
        
        if (msg.type === 'system') {
            textToCopy += `[システム] ${msg.content}\n\n`;
        } else if (msg.type === 'message') {
            const timeStr = msg.time ? ` (${msg.time})` : "";
            textToCopy += `${msg.speaker}${timeStr}:\n「${msg.message}」\n\n`;
        }
    }
    
    // 末尾の改行を削除
    textToCopy = textToCopy.trim();

    try {
        await navigator.clipboard.writeText(textToCopy);
        
        // ボタンの表示を一時的に変更
        const originalText = btnElement.textContent;
        btnElement.textContent = 'コピー完了!';
        btnElement.style.backgroundColor = '#dff0d8';
        btnElement.style.borderColor = '#d6e9c6';
        
        setTimeout(() => {
            btnElement.textContent = originalText;
            btnElement.style.backgroundColor = '';
            btnElement.style.borderColor = '';
        }, 1500);
    } catch (err) {
        console.error('コピーに失敗しました', err);
        btnElement.textContent = 'エラー';
        btnElement.style.color = 'red';
    }
}
