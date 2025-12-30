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

    messages.forEach(msg => {
        if (msg.type === 'date') {
            const el = document.createElement('div');
            el.className = 'date-header';
            el.textContent = msg.content;
            container.appendChild(el);
            return;
        }

        if (msg.type === 'system') {
            const el = document.createElement('div');
            el.className = 'system-message';
            el.textContent = msg.content;
            container.appendChild(el);
            return;
        }

        if (msg.type === 'message') {
            const wrapper = document.createElement('div');
            wrapper.className = 'message-item';

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
            copyBtn.onclick = () => copyMessageToClipboard(msg, copyBtn);

            wrapper.appendChild(header);
            wrapper.appendChild(content);
            wrapper.appendChild(copyBtn);
            container.appendChild(wrapper);
        }
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
