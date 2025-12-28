document.getElementById('exportBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = '取得中...';
  statusDiv.style.color = '#666';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // LINE WORKSのページかどうか確認（簡易チェック）
    // カスタムドメインの場合もあるので警告だけにするか、厳密にするか
    // worksmobile.com がURLに含まれているか確認
    if (!tab.url.includes('worksmobile.com')) {
      statusDiv.textContent = '注意: LINE WORKSのページではない可能性があります。';
      // 処理は続行してみる
    }

    // コンテンツスクリプトがロードされているか確認し、なければ注入する
    // (manifestで指定しているので基本的には不要だが、念のため)
    
    try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "extractTalk" });
        
        if (response && response.success) {
            if (response.data.length === 0) {
                statusDiv.textContent = '警告: メッセージが見つかりませんでした。DOM構造が変更されている可能性があります。';
                statusDiv.style.color = 'orange';
            } else {
                downloadFile(response.data, `line_works_talk_${getDateTimeString()}.txt`);
                statusDiv.textContent = `完了: ${response.count}件のメッセージを取得しました。`;
                statusDiv.style.color = 'green';
            }
        } else {
            statusDiv.textContent = 'エラー: ' + (response ? response.error : '不明なエラー');
            statusDiv.style.color = 'red';
        }
    } catch (msgError) {
        console.error(msgError);
        statusDiv.textContent = 'エラー: ページをリロードして再試行してください。';
        statusDiv.style.color = 'red';
    }

  } catch (error) {
    console.error(error);
    statusDiv.textContent = 'システムエラー: ' + error.message;
    statusDiv.style.color = 'red';
  }
});

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
