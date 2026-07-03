const API_BASE = 'http://localhost:5002';

document.addEventListener('DOMContentLoaded', function() {
    loadStats();
});

function loadStats() {
    try {
        fetch(`${API_BASE}/api/stats/overview`)
            .then(res => res.json())
            .then(data => {
                if (data) {
                    document.getElementById('statTotal').textContent = data.total_wrong_questions || data.total_questions || 0;
                    document.getElementById('statMastered').textContent = data.total_mastered || data.mastered_count || 0;
                    document.getElementById('statToday').textContent = data.today_practiced || 0;
                }
            })
            .catch(err => {
                console.log('加载统计失败:', err);
                document.getElementById('statTotal').textContent = '0';
                document.getElementById('statMastered').textContent = '0';
                document.getElementById('statToday').textContent = '0';
            });
    } catch (e) {
        console.log('统计加载异常:', e);
    }
}

document.getElementById('openDashboard').addEventListener('click', function() {
    chrome.tabs.create({ url: 'http://localhost:5173' });
});

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
                    if (response.success && response.data) {
                        showStatus('采集成功，正在发送到服务器...', 'info');
                        chrome.runtime.sendMessage({
                            action: 'sendToBackend',
                            data: response.data
                        }, function(backendResponse) {
                            if (chrome.runtime.lastError) {
                                showStatus('发送失败：' + chrome.runtime.lastError.message, 'error');
                                return;
                            }
                            if (backendResponse && backendResponse.success) {
                                showStatus('✓ 采集并发送成功！', 'success');
                                loadStats();
                            } else {
                                showStatus('发送失败：' + (backendResponse ? backendResponse.error : '未知错误'), 'error');
                            }
                        });
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
    showStatus('正在采集所有错题，请稍候...', 'info');

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
                        const total = response.total || (response.data ? response.data.length : 0);
                        const successCount = response.successCount || total;
                        const failCount = response.failCount || 0;
                        showStatus(`✓ 完成：成功 ${successCount} 道，失败 ${failCount} 道`, 'success');
                        loadStats();
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
        }, 4000);
    }
}