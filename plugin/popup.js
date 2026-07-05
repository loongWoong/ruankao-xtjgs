document.addEventListener('DOMContentLoaded', function() {
    loadStats();
    checkBackendStatus();
    loadPendingQueueCount();
    loadSessionHistory();
    loadUserIdSetting();

    document.getElementById('retryQueueBtn').addEventListener('click', function() {
        retryPendingQueue();
    });

    document.getElementById('collectSession').addEventListener('click', collectPracticeSession);

    // user_id 输入失焦时保存
    const userIdInput = document.getElementById('userIdInput');
    if (userIdInput) {
        userIdInput.addEventListener('blur', function() {
            saveUserIdSetting(this.value.trim());
        });
        userIdInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                this.blur();
            }
        });
    }
});

const USER_ID_STORAGE_KEY = 'plugin_user_id';

function loadUserIdSetting() {
    try {
        chrome.storage.local.get(USER_ID_STORAGE_KEY, function(result) {
            const input = document.getElementById('userIdInput');
            if (input) {
                input.value = result[USER_ID_STORAGE_KEY] || '';
            }
        });
    } catch (e) {
        console.error('加载 user_id 失败:', e);
    }
}

function saveUserIdSetting(value) {
    // 空值允许（表示用后端默认 default_user）
    const trimmed = (value || '').substring(0, 50);
    try {
        chrome.storage.local.set({ [USER_ID_STORAGE_KEY]: trimmed }, function() {
            const statusDiv = document.getElementById('status');
            if (statusDiv && trimmed) {
                statusDiv.className = 'info';
                statusDiv.textContent = '已保存用户标识：' + trimmed;
                setTimeout(function() {
                    statusDiv.textContent = '';
                    statusDiv.className = '';
                }, 2000);
            }
        });
    } catch (e) {
        console.error('保存 user_id 失败:', e);
    }
}

function loadStats() {
    try {
        // 通过 background 中转拉取统计，避免 popup 直接跨域请求导致 CORS 问题
        chrome.runtime.sendMessage({ action: 'loadStats' }, function(response) {
            if (chrome.runtime.lastError) {
                console.log('加载统计失败:', chrome.runtime.lastError);
                setStatsEmpty();
                return;
            }
            if (response && response.success && response.data) {
                const data = response.data;
                document.getElementById('statTotal').textContent = data.total_wrong_questions || data.total_questions || 0;
                document.getElementById('statMastered').textContent = data.total_mastered || data.mastered_count || 0;
                document.getElementById('statToday').textContent = data.today_practiced || 0;
            } else {
                setStatsEmpty();
            }
        });
    } catch (e) {
        console.log('统计加载异常:', e);
        setStatsEmpty();
    }
}

function setStatsEmpty() {
    document.getElementById('statTotal').textContent = '0';
    document.getElementById('statMastered').textContent = '0';
    document.getElementById('statToday').textContent = '0';
}

function checkBackendStatus() {
    try {
        chrome.runtime.sendMessage({ action: 'checkBackendStatus' }, function(response) {
            if (chrome.runtime.lastError) {
                console.error('检查后端状态失败:', chrome.runtime.lastError);
                setStatusIndicator('unknown');
                return;
            }
            if (response && response.online) {
                setStatusIndicator('online');
            } else {
                setStatusIndicator('offline');
            }
        });
    } catch (e) {
        console.error('检查后端状态异常:', e);
        setStatusIndicator('unknown');
    }
}

function setStatusIndicator(status) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');

    dot.className = 'status-dot';

    if (status === 'online') {
        dot.classList.add('online');
        text.textContent = '后端在线';
        text.style.color = '#4caf50';
    } else if (status === 'offline') {
        dot.classList.add('offline');
        text.textContent = '后端离线';
        text.style.color = '#f44336';
    } else {
        text.textContent = '未知';
        text.style.color = '#999';
    }
}

function loadPendingQueueCount() {
    try {
        chrome.runtime.sendMessage({ action: 'getPendingQueueCount' }, function(response) {
            if (chrome.runtime.lastError) {
                console.error('获取待发送队列数量失败:', chrome.runtime.lastError);
                return;
            }
            if (response) {
                updateQueueDisplay(response.count || 0);
            }
        });
    } catch (e) {
        console.error('获取待发送队列数量异常:', e);
    }
}

function updateQueueDisplay(count) {
    const queueInfo = document.getElementById('queueInfo');
    const queueCountText = document.getElementById('queueCountText');

    if (count > 0) {
        queueInfo.classList.add('visible');
        queueCountText.textContent = `待发送：${count} 条`;
    } else {
        queueInfo.classList.remove('visible');
    }
}

function retryPendingQueue() {
    const btn = document.getElementById('retryQueueBtn');
    const originalText = btn.textContent;

    btn.disabled = true;
    btn.textContent = '重试中...';

    try {
        chrome.runtime.sendMessage({ action: 'retryPendingQueue' }, function(response) {
            btn.disabled = false;
            btn.textContent = originalText;

            if (chrome.runtime.lastError) {
                console.error('重试待发送队列失败:', chrome.runtime.lastError);
                showStatus('重试失败：' + chrome.runtime.lastError.message, 'error');
                return;
            }

            if (response && response.success) {
                updateQueueDisplay(response.remaining || 0);
                if (response.remaining === 0) {
                    showStatus('✓ 所有待发送数据已发送成功', 'success');
                } else {
                    showStatus(`部分发送成功，剩余 ${response.remaining} 条`, 'info');
                }
                loadStats();
            } else {
                showStatus('重试失败：' + (response ? response.error : '未知错误'), 'error');
            }
        });
    } catch (e) {
        btn.disabled = false;
        btn.textContent = originalText;
        console.error('重试待发送队列异常:', e);
        showStatus('重试失败：' + e.message, 'error');
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
                        // 展示数据质量警告（若有）
                        if (response.warnings && response.warnings.length > 0) {
                            showStatus('采集到数据但存在警告：' + response.warnings.join('；'), 'info');
                        } else {
                            showStatus('采集成功，正在发送到服务器...', 'info');
                        }
                        chrome.runtime.sendMessage({
                            action: 'sendToBackend',
                            data: response.data
                        }, function(backendResponse) {
                            if (chrome.runtime.lastError) {
                                showStatus('发送失败：' + chrome.runtime.lastError.message, 'error');
                                return;
                            }
                            if (backendResponse && backendResponse.success) {
                                if (backendResponse.skipped) {
                                    showStatus('题目已采集，无需重复', 'info');
                                } else if (backendResponse.queued) {
                                    showStatus('网络异常，已加入待发送队列', 'info');
                                    loadPendingQueueCount();
                                } else {
                                    showStatus('✓ 采集并发送成功！', 'success');
                                }
                                loadStats();
                                loadPendingQueueCount();
                            } else {
                                showStatus('发送失败：' + (backendResponse ? backendResponse.error : '未知错误'), 'error');
                                loadPendingQueueCount();
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
                        loadPendingQueueCount();
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

function collectPracticeSession() {
    showStatus('正在采集练习结果...', 'info');

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) {
            showStatus('无法获取当前标签页', 'error');
            return;
        }

        try {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'collectPracticeSession'}, function(response) {
                if (chrome.runtime.lastError) {
                    console.error('Chrome runtime error:', chrome.runtime.lastError);
                    showStatus('采集失败：内容脚本未加载，请刷新页面后重试', 'error');
                    return;
                }

                if (response) {
                    if (response.success && response.data) {
                        showStatus('采集成功，正在发送到服务器...', 'info');
                        chrome.runtime.sendMessage({
                            action: 'sendSession',
                            data: response.data
                        }, function(backendResponse) {
                            if (chrome.runtime.lastError) {
                                showStatus('发送失败：' + chrome.runtime.lastError.message, 'error');
                                return;
                            }
                            if (backendResponse && backendResponse.success) {
                                const d = response.data;
                                const scoreText = d.score > 0 ? `${d.score}分` : `${Math.round((d.accuracy || 0) * 100)}%`;
                                showStatus(`✓ 练习结果已保存：${d.paper_name || '未命名'} ${d.correct_count}/${d.total_questions} (${scoreText})`, 'success');
                                loadSessionHistory();
                            } else if (backendResponse && backendResponse.queued) {
                                showStatus('网络异常，已加入待发送队列', 'info');
                                loadPendingQueueCount();
                                loadSessionHistory();
                            } else {
                                showStatus('发送失败：' + (backendResponse ? backendResponse.error : '未知错误'), 'error');
                            }
                        });
                    } else {
                        showStatus('采集失败：' + (response.error || '未识别到结果页，请在交卷结果页使用'), 'error');
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
}

function loadSessionHistory() {
    try {
        chrome.runtime.sendMessage({ action: 'getSessionHistory' }, function(response) {
            if (chrome.runtime.lastError) {
                console.log('加载采集历史失败:', chrome.runtime.lastError);
                renderSessionHistory([]);
                return;
            }
            if (response && response.success) {
                renderSessionHistory(response.items || []);
            } else {
                renderSessionHistory([]);
            }
        });
    } catch (e) {
        console.error('加载采集历史异常:', e);
        renderSessionHistory([]);
    }
}

function renderSessionHistory(items) {
    const container = document.getElementById('sessionHistory');
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = '<div class="history-empty">暂无采集记录</div>';
        return;
    }

    const html = items.slice(0, 10).map(function(item) {
        const name = (item.paper_name || '未命名练习').substring(0, 20);
        const scoreText = item.score > 0 ? item.score + '分' : Math.round((item.accuracy || 0) * 100) + '%';
        const correctText = item.total_questions > 0 ? (item.correct_count + '/' + item.total_questions) : '';
        const syncIcon = item.synced ? '<span class="history-item-synced">✓</span>' : '<span class="history-item-unsynced">待同步</span>';
        return '<div class="history-item">' +
            '<div class="history-item-name">' + escapeHtml(name) + '</div>' +
            '<div class="history-item-score">' + correctText + ' ' + scoreText + '</div>' +
            syncIcon +
            '</div>';
    }).join('');
    container.innerHTML = html;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
