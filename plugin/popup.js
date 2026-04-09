document.getElementById('collect').addEventListener('click', function() {
    showStatus('正在采集...', 'info');

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) {
            showStatus('无法获取当前标签页', 'error');
            return;
        }

        try {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'collectCurrentQuestion'}, function(response) {
                if (chrome.runtime.lastError) {
                    console.error('Chrome runtime error:', chrome.runtime.lastError);
                    showStatus('采集失败：内容脚本未加载，请刷新页面后重试', 'error');
                    return;
                }

                if (response) {
                    if (response.success) {
                        showStatus('采集成功！', 'success');
                    } else {
                        showStatus('采集失败：' + (response.error || '未知错误'), 'error');
                    }
                } else {
                    showStatus('采集失败：无法与页面通信', 'error');
                }
            });
        } catch (e) {
            console.error('发送消息异常:', e);
            showStatus('采集失败：' + e.message, 'error');
        }
    });
});

document.getElementById('collectAll').addEventListener('click', function() {
    showStatus('正在采集所有错题...', 'info');

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) {
            showStatus('无法获取当前标签页', 'error');
            return;
        }

        try {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'collectAllWrongQuestions'}, function(response) {
                if (chrome.runtime.lastError) {
                    console.error('Chrome runtime error:', chrome.runtime.lastError);
                    showStatus('采集失败：内容脚本未加载，请刷新页面后重试', 'error');
                    return;
                }

                if (response) {
                    if (response.success) {
                        showStatus('采集所有错题成功！', 'success');
                    } else {
                        showStatus('采集失败：' + (response.error || '未知错误'), 'error');
                    }
                } else {
                    showStatus('采集失败：无法与页面通信', 'error');
                }
            });
        } catch (e) {
            console.error('发送消息异常:', e);
            showStatus('采集失败：' + e.message, 'error');
        }
    });
});

function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.className = type;
    statusDiv.textContent = message;

    if (type !== 'info') {
        setTimeout(function() {
            statusDiv.textContent = '';
            statusDiv.className = '';
        }, 3000);
    }
}