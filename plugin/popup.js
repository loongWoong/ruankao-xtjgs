document.addEventListener('DOMContentLoaded', function() {
    loadStats();
    checkBackendStatus();
    loadPendingQueueCount();
    loadSessionHistory();
    loadUserIdSetting();
    loadDeadLetterCount();

    document.getElementById('retryQueueBtn').addEventListener('click', function() {
        retryPendingQueue();
    });

    document.getElementById('collectSession').addEventListener('click', collectPracticeSession);

    // 35C: 死信清除按钮
    document.getElementById('clearDeadLetterBtn').addEventListener('click', clearDeadLetters);

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

    // D6: popup 打开期间每 5 秒轮询队列数量，确保用户及时看到离线堆积
    // popup 关闭时 interval 自动清除（popup 上下文销毁），无需手动 cleanup
    let pollTickCount = 0;
    const pollTimer = setInterval(function() {
        loadPendingQueueCount();
        // 30B: 每 5 秒刷新后端状态（后端恢复时及时从"离线"切回"在线"）
        checkBackendStatus();
        // 30C: 每 30 秒（6 轮）刷新一次统计（比队列/状态重，频率低些避免给后端压力）
        pollTickCount++;
        if (pollTickCount % 6 === 0) {
            loadStats();
            loadSessionHistory();
            loadDeadLetterCount();
        }
    }, 5000);

    // 兜底：页面卸载时清除 timer（虽然 popup 关闭即销毁，此为防御性编程）
    window.addEventListener('unload', function() {
        clearInterval(pollTimer);
    });
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
    // 加载失败时显示 '--' 而非 '0'，避免误导用户以为真的没有数据
    document.getElementById('statTotal').textContent = '--';
    document.getElementById('statMastered').textContent = '--';
    document.getElementById('statToday').textContent = '--';
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
    const btn = this;
    // D2: 防止重复点击导致重复采集/发送
    if (btn.disabled) return;
    btn.disabled = true;
    const done = function() { btn.disabled = false; };

    showStatus('正在采集...', 'info');

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) {
            showStatus('无法获取当前标签页', 'error');
            done();
            return;
        }

        try {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'collectCurrentQuestion'}, function(response) {
                if (chrome.runtime.lastError) {
                    console.error('Chrome runtime error:', chrome.runtime.lastError);
                    showStatus('采集失败：内容脚本未加载，请刷新页面后重试', 'error');
                    done();
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
                            done();
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
                        done();
                    }
                } else {
                    showStatus('采集失败：无法与页面通信', 'error');
                    done();
                }
            });
        } catch (e) {
            console.error('发送消息异常:', e);
            showStatus('采集失败：' + e.message, 'error');
            done();
        }
    });
});

document.getElementById('collectAll').addEventListener('click', function() {
    const btn = this;
    // D2: 批量采集耗时较长，必须防止重复点击
    if (btn.disabled) return;
    btn.disabled = true;
    const done = function() { btn.disabled = false; };

    showStatus('正在采集所有错题，请稍候...', 'info');

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) {
            showStatus('无法获取当前标签页', 'error');
            done();
            return;
        }

        try {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'collectAllWrongQuestions'}, function(response) {
                done();
                if (chrome.runtime.lastError) {
                    console.error('Chrome runtime error:', chrome.runtime.lastError);
                    showStatus('采集失败：内容脚本未加载，请刷新页面后重试', 'error');
                    return;
                }

                if (response) {
                    if (response.success) {
                        const total = response.total || (response.data ? response.data.length : 0);
                        const dedupedCount = response.dedupedCount || 0;
                        const failCount = response.failCount || 0;
                        const inserted = response.inserted || 0;
                        const updated = response.updated || 0;
                        const queued = response.queued || 0;
                        const errors = response.errors || [];
                        // 拆分展示：新增/更新/去重/离线队列/失败
                        let msg = `✓ 完成：共 ${total} 道`;
                        if (inserted > 0) msg += `，新增 ${inserted}`;
                        if (updated > 0) msg += `，更新 ${updated}`;
                        if (dedupedCount > 0) msg += `，去重 ${dedupedCount}`;
                        if (queued > 0) msg += `，离线队列 ${queued}`;
                        if (failCount > 0) msg += `，失败 ${failCount}`;
                        // 展示前几条失败原因（来自后端 per-item errors）
                        if (errors.length > 0) {
                            const detail = errors.slice(0, 2).map(e => e.error || e.message || JSON.stringify(e)).join('；');
                            msg += '。失败原因：' + detail.substring(0, 80);
                            if (errors.length > 2) msg += '...';
                        }
                        showStatus(msg, failCount > 0 ? 'info' : 'success');
                        loadStats();
                        loadPendingQueueCount();
                        loadSessionHistory();
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
            done();
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
    const btn = document.getElementById('collectSession');
    // D2: 防止重复点击
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    const done = function() { if (btn) btn.disabled = false; };

    showStatus('正在采集练习结果...', 'info');

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) {
            showStatus('无法获取当前标签页', 'error');
            done();
            return;
        }

        try {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'collectPracticeSession'}, function(response) {
                if (chrome.runtime.lastError) {
                    console.error('Chrome runtime error:', chrome.runtime.lastError);
                    showStatus('采集失败：内容脚本未加载，请刷新页面后重试', 'error');
                    done();
                    return;
                }

                if (response) {
                    if (response.success && response.data) {
                        showStatus('采集成功，正在发送到服务器...', 'info');
                        chrome.runtime.sendMessage({
                            action: 'sendSession',
                            data: response.data
                        }, function(backendResponse) {
                            done();
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
                        done();
                    }
                } else {
                    showStatus('采集失败：无法与页面通信', 'error');
                    done();
                }
            });
        } catch (e) {
            console.error('发送消息异常:', e);
            showStatus('采集失败：' + e.message, 'error');
            done();
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

    const html = items.slice(0, 20).map(function(item) {
        const name = (item.paper_name || '未命名练习').substring(0, 20);
        const scoreText = item.score > 0 ? item.score + '分' : Math.round((item.accuracy || 0) * 100) + '%';
        const correctText = item.total_questions > 0 ? (item.correct_count + '/' + item.total_questions) : '';
        // 35D: synced 可能是 true / false / 'dead' 三态
        //   true  → 已同步（绿 ✓）
        //   false → 待同步（橙"待同步"）
        //   'dead'→ 重试耗尽已丢弃（红"已丢弃"），用户需重新采集
        let syncIcon;
        if (item.synced === 'dead') {
            syncIcon = '<span class="history-item-dead">已丢弃</span>';
        } else if (item.synced) {
            syncIcon = '<span class="history-item-synced">✓</span>';
        } else {
            syncIcon = '<span class="history-item-unsynced">待同步</span>';
        }
        // D4: 展示相对时间，让用户知道这条记录是何时采集的
        const timeText = formatRelativeTime(item.synced_at || item.timestamp);
        return '<div class="history-item">' +
            '<div class="history-item-name">' + escapeHtml(name) + '</div>' +
            '<div class="history-item-score">' + correctText + ' ' + scoreText +
            (timeText ? ' <span class="history-item-time">' + timeText + '</span>' : '') +
            '</div>' +
            syncIcon +
            '</div>';
    }).join('');
    container.innerHTML = html;
}

// D4: 将时间戳转为相对时间描述（如"3分钟前""2小时前"）
function formatRelativeTime(ts) {
    if (!ts || typeof ts !== 'number') return '';
    const now = Date.now();
    const diff = now - ts;
    if (diff < 0) return '';
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / (60 * 1000)) + '分钟前';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / (60 * 60 * 1000)) + '小时前';
    if (diff < 30 * 24 * 60 * 60 * 1000) return Math.floor(diff / (24 * 60 * 60 * 1000)) + '天前';
    // 超过 30 天显示日期
    const d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 35C: 死信队列展示 — 重试耗尽或 4xx 不可重试错误导致的数据丢弃
// popup 显示丢弃数量，用户可点击"清除"按钮清理
function loadDeadLetterCount() {
    try {
        chrome.runtime.sendMessage({ action: 'getDeadLetterCount' }, function(response) {
            if (chrome.runtime.lastError) {
                return;
            }
            const count = (response && response.count) || 0;
            updateDeadLetterDisplay(count);
        });
    } catch (e) {
        console.error('加载死信数量失败:', e);
    }
}

function updateDeadLetterDisplay(count) {
    const info = document.getElementById('deadLetterInfo');
    const text = document.getElementById('deadLetterText');
    if (!info || !text) return;
    if (count > 0) {
        text.textContent = `丢弃：${count} 条（重试耗尽，需重新采集）`;
        info.classList.add('visible');
    } else {
        info.classList.remove('visible');
    }
}

function clearDeadLetters() {
    try {
        chrome.runtime.sendMessage({ action: 'clearDeadLetterQueue' }, function(response) {
            if (chrome.runtime.lastError) {
                showStatus('清除失败：' + chrome.runtime.lastError.message, 'error');
                return;
            }
            if (response && response.success) {
                updateDeadLetterDisplay(0);
                showStatus('已清除死信记录', 'success');
            } else {
                showStatus('清除失败：' + (response ? response.error : '未知错误'), 'error');
            }
        });
    } catch (e) {
        console.error('清除死信失败:', e);
        showStatus('清除失败：' + e.message, 'error');
    }
}
