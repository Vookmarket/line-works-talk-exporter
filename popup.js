document.addEventListener('DOMContentLoaded', () => {
    // 起動時にメッセージを取得して表示
    fetchAndDisplayMessages();

    // 保存ボタンのイベントリスナー
    document.getElementById('exportBtn').addEventListener('click', fetchAndDownloadMessages);
});

/**
 * メッセージを取得して画面に表示する（ダウンロードはしない）
 */
async function fetchAndDisplayMessages() {
    const statusDiv = document.getElementById('status');
    const resultContainer = document.getElementById('result-container');
    
    statusDiv.textContent = '読み込み中...';
    statusDiv.style.color = '#666';
    resultContainer.style.display = 'none';
    resultContainer.innerHTML = '';

    const response = await extractMessages(statusDiv);
    
    if (response && response.success) {
        if (response.count === 0) {
            statusDiv.textContent = '警告: メッセージが見つかりませんでした。DOM構造が変更されている可能性があります。';
            statusDiv.style.color = 'orange';
        } else {
            // 画面表示処理
            renderResults(response.rawData);
            resultContainer.style.display = 'flex';
            
            statusDiv.textContent = `完了: ${response.count}件のメッセージを表示しています。`;
            statusDiv.style.color = 'green';
        }
    }
}

/**
 * メッセージを取得してダウンロードする（画面表示は更新しない、または更新しても良いが主目的はDL）
 */
async function fetchAndDownloadMessages() {
    const statusDiv = document.getElementById('status');
    
    // ステータス更新（「取得中...」など表示したいが、リストが表示されている場合は上書きに注意）
    const originalText = statusDiv.textContent;
    statusDiv.textContent = '保存用データを取得中...';
    
    const response = await extractMessages(statusDiv);
    
    if (response && response.success) {
        if (response.count === 0) {
            statusDiv.textContent = '警告: メッセージが見つかりませんでした。';
            statusDiv.style.color = 'orange';
        } else {
            // ダウンロード処理
            downloadFile(response.data, `line_works_talk_${getDateTimeString()}.txt`);
            
            statusDiv.textContent = `保存完了: ${response.count}件のメッセージを保存しました。`;
            statusDiv.style.color = 'green';
            
            // 念のためリストも更新しておく（同期ズレ防止）
            const resultContainer = document.getElementById('result-container');
            renderResults(response.rawData);
            resultContainer.style.display = 'flex';
        }
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
            // 続行はする
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
