const API_URL = 'http://localhost:5002/api/wrong-questions';
const BATCH_API_URL = 'http://localhost:5002/api/wrong-questions/batch';
const PENDING_QUEUE_KEY = 'pending_queue';
const DEDUP_KEY = 'dedup_map';
const DEDUP_TTL = 5 * 60 * 1000;
const MAX_RETRIES = 3;
const ALARM_NAME = 'retry_pending_queue';
const ALARM_INTERVAL = 0.5;
const BATCH_CHUNK_SIZE = 200;

let dedupMap = {};

loadDedupMap();

chrome.runtime.onInstalled.addListener(function() {
    console.log('软考达人做题记录采集插件已安装');

    chrome.contextMenus.create({
        id: 'collectQuestion',
        title: '采集当前题目到错题库',
        contexts: ['page']
    });

    chrome.contextMenus.create({
        id: 'collectAllWrong',
        title: '采集所有可见错题',
        contexts: ['page']
    });

    chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_INTERVAL });

    console.log('右键菜单已创建，定时重发已启动');
});

chrome.alarms.onAlarm.addListener(function(alarm) {
    if (alarm.name === ALARM_NAME) {
        processPendingQueue();
    }
});

async function loadDedupMap() {
    try {
        const result = await chrome.storage.local.get(DEDUP_KEY);
        if (result[DEDUP_KEY]) {
            dedupMap = result[DEDUP_KEY];
        }
    } catch (e) {
        console.error('加载去重映射失败:', e);
    }
}

async function saveDedupMap() {
    try {
        await chrome.storage.local.set({ [DEDUP_KEY]: dedupMap });
    } catch (e) {
        console.error('保存去重映射失败:', e);
    }
}

function isDuplicate(questionId) {
    if (!questionId) return false;
    const now = Date.now();
    if (dedupMap[questionId] && (now - dedupMap[questionId]) < DEDUP_TTL) {
        return true;
    }
    dedupMap[questionId] = now;
    saveDedupMap();
    return false;
}

async function addToPendingQueue(data) {
    try {
        const result = await chrome.storage.local.get(PENDING_QUEUE_KEY);
        const queue = result[PENDING_QUEUE_KEY] || [];
        queue.push({
            data: data,
            timestamp: Date.now(),
            retryCount: 0
        });
        await chrome.storage.local.set({ [PENDING_QUEUE_KEY]: queue });
        console.log('数据已加入待发送队列，当前队列长度:', queue.length);
        return true;
    } catch (e) {
        console.error('加入待发送队列失败:', e);
        return false;
    }
}

async function getPendingQueue() {
    try {
        const result = await chrome.storage.local.get(PENDING_QUEUE_KEY);
        return result[PENDING_QUEUE_KEY] || [];
    } catch (e) {
        console.error('获取待发送队列失败:', e);
        return [];
    }
}

async function setPendingQueue(queue) {
    try {
        await chrome.storage.local.set({ [PENDING_QUEUE_KEY]: queue });
    } catch (e) {
        console.error('设置待发送队列失败:', e);
    }
}

async function sendToBackend(data, skipDedup = false) {
    if (!skipDedup && data.question_id && isDuplicate(data.question_id)) {
        console.log('题目重复，跳过发送:', data.question_id);
        return { success: true, skipped: true, reason: 'duplicate' };
    }

    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('发送到后端成功:', result);
                return { success: true, data: result };
            }

            lastError = new Error('HTTP ' + response.status);
            console.warn(`发送失败，第 ${attempt + 1} 次尝试:`, lastError.message);
        } catch (e) {
            lastError = e;
            console.warn(`发送失败，第 ${attempt + 1} 次尝试:`, e.message);
        }

        if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    console.error('所有重试都失败，加入离线队列');
    await addToPendingQueue(data);

    return { success: false, error: lastError ? lastError.message : '未知错误', queued: true };
}

async function sendBatchToBackend(items) {
    // 批量发送错题到后端。先做去重（基于 question_id），再分块（每块 <= BATCH_CHUNK_SIZE）发送。
    // 返回 { success, total, inserted, updated, failed, queued }
    if (!Array.isArray(items) || items.length === 0) {
        return { success: true, total: 0, inserted: 0, updated: 0, failed: 0, queued: 0 };
    }

    // 去重：同一批次内相同 question_id 只发一次；同时检查 5 分钟内已发过的
    const uniqueItems = [];
    const seenIds = new Set();
    for (const item of items) {
        const qid = item && item.question_id;
        if (qid && seenIds.has(qid)) {
            continue;
        }
        if (qid && isDuplicate(qid)) {
            continue;
        }
        if (qid) {
            seenIds.add(qid);
        }
        uniqueItems.push(item);
    }

    if (uniqueItems.length === 0) {
        return { success: true, total: items.length, inserted: 0, updated: 0, failed: 0, queued: 0, skipped: items.length };
    }

    let totalInserted = 0;
    let totalUpdated = 0;
    let totalFailed = 0;
    let totalQueued = 0;

    // 分块发送
    for (let i = 0; i < uniqueItems.length; i += BATCH_CHUNK_SIZE) {
        const chunk = uniqueItems.slice(i, i + BATCH_CHUNK_SIZE);
        let lastError = null;
        let success = false;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(BATCH_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ questions: chunk })
                });

                if (response.ok) {
                    const result = await response.json();
                    totalInserted += result.inserted || 0;
                    totalUpdated += result.updated || 0;
                    totalFailed += result.failed || 0;
                    success = true;
                    break;
                }

                lastError = new Error('HTTP ' + response.status);
            } catch (e) {
                lastError = e;
            }

            if (attempt < MAX_RETRIES) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        if (!success) {
            // 批量发送失败，整块加入离线队列（逐条加入，复用单条队列处理）
            for (const item of chunk) {
                await addToPendingQueue(item);
            }
            totalQueued += chunk.length;
        }
    }

    return {
        success: totalFailed === 0 && totalQueued === 0,
        total: items.length,
        inserted: totalInserted,
        updated: totalUpdated,
        failed: totalFailed,
        queued: totalQueued,
        skipped: items.length - uniqueItems.length
    };
}

async function processPendingQueue() {
    const queue = await getPendingQueue();
    if (queue.length === 0) return;

    console.log(`开始处理待发送队列，共 ${queue.length} 条`);

    const remaining = [];
    let successCount = 0;

    for (const item of queue) {
        try {
            const result = await sendToBackend(item.data, true);
            if (result.success) {
                successCount++;
            } else {
                remaining.push(item);
            }
        } catch (e) {
            console.error('处理队列项失败:', e);
            remaining.push(item);
        }
    }

    await setPendingQueue(remaining);

    if (successCount > 0) {
        console.log(`待发送队列处理完成：成功 ${successCount} 条，剩余 ${remaining.length} 条`);
    }
}

chrome.contextMenus.onClicked.addListener(function(info, tab) {
    if (info.menuItemId === 'collectQuestion') {
        chrome.tabs.sendMessage(tab.id, {action: 'collectCurrentQuestion'}, async function(response) {
            if (chrome.runtime.lastError) {
                console.error('发送消息失败:', chrome.runtime.lastError);
                return;
            }
            console.log('采集结果:', response);
            if (response && response.success && response.data) {
                await sendToBackend(response.data);
            }
        });
    } else if (info.menuItemId === 'collectAllWrong') {
        chrome.tabs.sendMessage(tab.id, {action: 'collectAllWrongQuestions'}, function(response) {
            if (chrome.runtime.lastError) {
                console.error('发送消息失败:', chrome.runtime.lastError);
                return;
            }
            console.log('采集所有错题结果:', response);
        });
    }
});

chrome.commands.onCommand.addListener(function(command) {
    if (command === 'collect-question') {
        console.log('快捷键触发，采集题目');

        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length === 0) {
                console.error('没有找到活动标签页');
                return;
            }

            const tab = tabs[0];

            if (!tab.url || !tab.url.includes('ruankaodaren.com/exam')) {
                console.log('当前页面不是软考达人考试页面');
                return;
            }

            chrome.tabs.sendMessage(tab.id, {action: 'collectCurrentQuestion'}, async function(response) {
                if (chrome.runtime.lastError) {
                    console.error('发送消息失败:', chrome.runtime.lastError);
                    return;
                }
                console.log('快捷键采集结果:', response);
                if (response && response.success && response.data) {
                    await sendToBackend(response.data);
                }
            });
        });
    }
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'sendToBackend') {
        console.log('收到发送到后端的请求:', request.data);

        sendToBackend(request.data)
            .then(result => {
                sendResponse(result);
            })
            .catch(error => {
                console.error('发送到后端异常:', error);
                sendResponse({ success: false, error: error.message });
            });

        return true;
    } else if (request.action === 'sendBatchToBackend') {
        console.log('收到批量发送到后端的请求，共', (request.items || []).length, '条');

        sendBatchToBackend(request.items)
            .then(result => {
                sendResponse(result);
            })
            .catch(error => {
                console.error('批量发送异常:', error);
                sendResponse({ success: false, error: error.message, total: (request.items || []).length, failed: (request.items || []).length });
            });

        return true;
    } else if (request.action === 'getTabUrl') {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length > 0) {
                sendResponse({ url: tabs[0].url });
            } else {
                sendResponse({ url: null });
            }
        });
        return true;
    } else if (request.action === 'getPendingQueueCount') {
        getPendingQueue().then(queue => {
            sendResponse({ count: queue.length });
        }).catch(() => {
            sendResponse({ count: 0 });
        });
        return true;
    } else if (request.action === 'retryPendingQueue') {
        processPendingQueue().then(() => {
            return getPendingQueue();
        }).then(queue => {
            sendResponse({ success: true, remaining: queue.length });
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    } else if (request.action === 'checkBackendStatus') {
        fetch(API_URL.replace('/wrong-questions', '/stats/overview'), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => {
            sendResponse({ online: response.ok });
        })
        .catch(() => {
            sendResponse({ online: false });
        });
        return true;
    }

    return true;
});

console.log('Background script loaded');
