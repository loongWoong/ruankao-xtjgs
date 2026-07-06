const API_URL = 'http://localhost:5002/api/wrong-questions';
const BATCH_API_URL = 'http://localhost:5002/api/wrong-questions/batch';
const SESSION_API_URL = 'http://localhost:5002/api/practice-sessions';
const PENDING_QUEUE_KEY = 'pending_queue';
const DEDUP_KEY = 'dedup_map';
const SESSION_HISTORY_KEY = 'session_history';
const USER_ID_STORAGE_KEY = 'plugin_user_id';
const DEDUP_TTL = 5 * 60 * 1000;
const MAX_RETRIES = 3;
const ALARM_NAME = 'retry_pending_queue';
const ALARM_INTERVAL = 1;  // Chrome MV3 alarms 最小周期为 1 分钟，低于 1 会被上取整
const BATCH_CHUNK_SIZE = 200;
const SESSION_HISTORY_LIMIT = 50;  // 提升上限：旧值 20 在用户一天多套练习时易丢失早期记录

// 读取 popup 配置的 user_id（缓存，避免每次发送都读 storage）
let cachedUserId = '';
let userIdLoaded = false;

async function loadUserId() {
    try {
        const result = await chrome.storage.local.get(USER_ID_STORAGE_KEY);
        cachedUserId = result[USER_ID_STORAGE_KEY] || '';
        userIdLoaded = true;
    } catch (e) {
        console.error('加载 user_id 失败:', e);
        cachedUserId = '';
        userIdLoaded = true;
    }
}

// 监听 storage 变化，实时刷新缓存
chrome.storage.onChanged.addListener(function(changes, areaName) {
    if (areaName === 'local' && changes[USER_ID_STORAGE_KEY]) {
        cachedUserId = changes[USER_ID_STORAGE_KEY].newValue || '';
        console.log('user_id 已更新:', cachedUserId || '(default_user)');
    }
});

function getUserId() {
    return cachedUserId || 'default_user';
}

let dedupMap = {};

// 初始化门控：SW 重启后 loadUserId/loadDedupMap 未完成前，消息处理需等待
// 否则 getUserId() 返回 'default_user'、isDuplicate() 漏判，导致数据落库到错误用户或重复入库
let initialized = false;
const initPromise = Promise.all([loadUserId(), loadDedupMap()]).then(() => {
    initialized = true;
}).catch(e => {
    console.error('background 初始化失败:', e);
    initialized = true;  // 即使失败也放行，避免永久阻塞
});

async function ensureInitialized() {
    if (!initialized) {
        await initPromise;
    }
}

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
        // 写盘前清理过期条目，防止 dedupMap 长期积累撑爆 chrome.storage.local
        // （每次发送成功都新增条目，但过期条目永不删除，5000 题后会占用数百 KB）
        const now = Date.now();
        let cleaned = 0;
        for (const qid in dedupMap) {
            const entry = dedupMap[qid];
            const ts = typeof entry === 'number' ? entry : (entry && entry.ts);
            if (!ts || (now - ts) >= DEDUP_TTL) {
                delete dedupMap[qid];
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`清理 ${cleaned} 条过期 dedup 条目`);
        }
        await chrome.storage.local.set({ [DEDUP_KEY]: dedupMap });
    } catch (e) {
        console.error('保存去重映射失败:', e);
    }
}

function isDuplicate(questionId, hasAnswer = false) {
    // 只读检查：仅判断是否在去重窗口内，不写入 dedupMap
    if (!questionId) return false;
    const now = Date.now();
    const entry = dedupMap[questionId];
    if (!entry) return false;

    // 兼容旧格式（纯数字时间戳）和新格式（{ts, has_answer}）
    const ts = typeof entry === 'number' ? entry : entry.ts;
    const prevHasAnswer = typeof entry === 'object' ? !!entry.has_answer : false;

    if ((now - ts) >= DEDUP_TTL) return false;
    // 关键升级场景：之前发送的没答案，本次有答案 → 允许补全
    if (!prevHasAnswer && hasAnswer) return false;
    return true;
}

function markSent(questionId, hasAnswer = false) {
    // 发送成功后才标记，避免失败时污染 dedupMap 导致 5 分钟内无法重采
    if (!questionId) return;
    dedupMap[questionId] = { ts: Date.now(), has_answer: !!hasAnswer };
    saveDedupMap();
}

// 批量场景：只更新内存，调用方负责在循环结束后调用 saveDedupMap() 一次写盘
function markSentBatch(items) {
    // items 可以是字符串数组（旧用法）或 { question_id, has_answer } 对象数组（新用法）
    if (!Array.isArray(items) || items.length === 0) return;
    const now = Date.now();
    for (const it of items) {
        if (!it) continue;
        if (typeof it === 'string') {
            dedupMap[it] = { ts: now, has_answer: false };
        } else if (it.question_id) {
            dedupMap[it.question_id] = { ts: now, has_answer: !!it.has_answer };
        }
    }
}

function unmarkSent(questionId) {
    // 发送失败时清除标记，允许立即重试
    if (!questionId) return;
    if (dedupMap[questionId]) {
        delete dedupMap[questionId];
        saveDedupMap();
    }
}

const PENDING_QUEUE_LIMIT = 500;  // 防止后端长时间离线时无限堆积撑爆 chrome.storage.local 配额

async function addToPendingQueue(data, type) {
    try {
        const result = await chrome.storage.local.get(PENDING_QUEUE_KEY);
        let queue = result[PENDING_QUEUE_KEY] || [];

        // 去重：同 question_id 已在队列则更新 timestamp，不重复插入
        // （session 无 question_id，按 paper_name + submitted_at 去重）
        const dedupKey = type === 'session'
            ? 'session_' + (data.paper_name || '') + '_' + (data.submitted_at || '')
            : (data && data.question_id);
        if (dedupKey) {
            const existIdx = queue.findIndex(x => {
                if (type === 'session') return x.type === 'session' && 'session_' + (x.data.paper_name || '') + '_' + (x.data.submitted_at || '') === dedupKey;
                return x.type !== 'session' && x.data && x.data.question_id === dedupKey;
            });
            if (existIdx >= 0) {
                queue[existIdx].timestamp = Date.now();
                queue[existIdx].retryCount = 0;
                await chrome.storage.local.set({ [PENDING_QUEUE_KEY]: queue });
                return true;
            }
        }

        // 上限保护：超限时丢弃最旧条目并告警
        if (queue.length >= PENDING_QUEUE_LIMIT) {
            console.warn(`待发送队列已达上限 ${PENDING_QUEUE_LIMIT}，丢弃最旧条目`);
            queue.shift();
        }

        queue.push({
            queue_id: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
            type: type || 'question',
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

async function sendToBackend(data, skipDedup = false, skipQueueOnFail = false) {
    // 判断本次数据是否带答案（用于"无答案→有答案"升级场景的去重豁免）
    const hasAnswer = !!(data.correct_answer || data.user_answer);

    if (!skipDedup && data.question_id && isDuplicate(data.question_id, hasAnswer)) {
        console.log('题目重复，跳过发送:', data.question_id);
        return { success: true, skipped: true, reason: 'duplicate' };
    }

    // 注入 popup 配置的 user_id（若 data 未显式携带）
    if (!data.user_id) {
        data.user_id = getUserId();
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
                // 发送成功后才标记去重，避免失败时污染 dedupMap
                markSent(data.question_id, hasAnswer);
                return { success: true, data: result };
            }

            lastError = new Error('HTTP ' + response.status);
            console.warn(`发送失败，第 ${attempt + 1} 次尝试:`, lastError.message);

            // 33D: HTTP 4xx (客户端错误) 不再重试，重试也是同样结果，浪费请求
            // 典型场景：400 (题干空/字段非法)、401 (user_id 无效)、422 (参数错误)
            // 429 (限流) 虽是 4xx 但应重试，单独豁免
            // 5xx (服务端错误) 仍按原逻辑重试
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                console.warn(`客户端错误 ${response.status}，不再重试`);
                break;
            }
        } catch (e) {
            lastError = e;
            console.warn(`发送失败，第 ${attempt + 1} 次尝试:`, e.message);
        }

        if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // 失败时清除去重标记（若曾标记），允许立即重试
    unmarkSent(data.question_id);

    // processPendingQueue 调用时 skipQueueOnFail=true，避免重复入队
    let actuallyQueued = false;
    if (!skipQueueOnFail) {
        console.error('所有重试都失败，加入离线队列');
        actuallyQueued = await addToPendingQueue(data, 'question');
        if (!actuallyQueued) {
            console.error('加入离线队列也失败，数据可能丢失');
        }
    }

    return { success: false, error: lastError ? lastError.message : '未知错误', queued: actuallyQueued };
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
    let allErrors = [];  // 收集后端 per-item 错误详情，供 popup 展示

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
                    body: JSON.stringify({ questions: chunk, user_id: getUserId() })
                });

                if (response.ok) {
                    const result = await response.json();
                    totalInserted += result.inserted || 0;
                    totalUpdated += result.updated || 0;
                    totalFailed += result.failed || 0;
                    // 透传后端 per-item 错误详情（含 index + error message），供 popup 展示
                    if (Array.isArray(result.errors) && result.errors.length > 0) {
                        allErrors = allErrors.concat(result.errors);
                    }
                    success = true;
                    // 批量发送成功后，标记 question_id 已发送并立即写盘
                    // （多 chunk 场景下，若延迟到循环外写盘，SW 在 chunk 间被 kill 会丢失标记）
                    // 传入 has_answer 标志，支持"无答案→有答案"升级场景的去重豁免
                    const sentItems = chunk.map(item => item && item.question_id ? {
                        question_id: item.question_id,
                        has_answer: !!(item.correct_answer || item.user_answer)
                    } : null).filter(Boolean);
                    markSentBatch(sentItems);
                    await saveDedupMap();
                    break;
                }

                lastError = new Error('HTTP ' + response.status);

                // 33D: HTTP 4xx (客户端错误) 不再重试（429 限流除外）
                if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                    console.warn(`批量发送客户端错误 ${response.status}，不再重试`);
                    break;
                }
            } catch (e) {
                lastError = e;
            }

            if (attempt < MAX_RETRIES) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        if (!success) {
            // 批量发送失败：整块加入离线队列，且不清除 dedupMap（这些 qid 本就未标记）
            for (const item of chunk) {
                await addToPendingQueue(item, 'question');
            }
            totalQueued += chunk.length;
        }
    }

    return {
        // 31D: success 判定修正：
        //   - totalQueued > 0 表示网络异常，部分数据未发出 → success=false（需重试）
        //   - totalFailed > 0 但 totalQueued=0 表示部分题目入库失败（如题干空），
        //     但网络本身正常，已尽力发送，不应判为整体失败（避免 popup 误报"采集失败"）
        //   - 仅当所有数据都入队（网络全断）时才 success=false
        success: totalQueued === 0,
        total: items.length,
        inserted: totalInserted,
        updated: totalUpdated,
        failed: totalFailed,
        queued: totalQueued,
        skipped: items.length - uniqueItems.length,
        errors: allErrors.slice(0, 20)  // 最多透传 20 条错误详情
    };
}

async function sendSessionToBackend(sessionData, skipQueueOnFail = false, skipHistoryOnFail = false) {
    // 发送练习会话结果到后端。带 3 次重试，失败入离线队列（复用 pending_queue）。
    // 成功后写入本地 session_history 供 popup 展示最近采集。
    // skipQueueOnFail: processPendingQueue 调用时传 true，避免重复入队
    // skipHistoryOnFail: processPendingQueue 调用时传 true，避免历史污染
    if (!sessionData.user_id) {
        sessionData.user_id = getUserId();
    }

    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(SESSION_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sessionData)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('练习会话发送成功:', result);
                // 记录到本地历史
                await appendSessionHistory({
                    ...sessionData,
                    backend_id: result.id,
                    synced: true,
                    synced_at: Date.now()
                });
                return { success: true, id: result.id };
            }

            lastError = new Error('HTTP ' + response.status);
            console.warn(`练习会话发送失败，第 ${attempt + 1} 次尝试:`, lastError.message);

            // 33D: HTTP 4xx (客户端错误) 不再重试（429 限流除外）
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                console.warn(`练习会话客户端错误 ${response.status}，不再重试`);
                break;
            }
        } catch (e) {
            lastError = e;
            console.warn(`练习会话发送失败，第 ${attempt + 1} 次尝试:`, e.message);
        }

        if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // 失败：入离线队列 + 本地历史标记未同步（processPendingQueue 调用时跳过）
    if (!skipQueueOnFail) {
        await addToPendingQueue(sessionData, 'session');
    }
    if (!skipHistoryOnFail) {
        await appendSessionHistory({
            ...sessionData,
            synced: false,
            synced_at: Date.now()
        });
    }
    return { success: false, error: lastError ? lastError.message : '未知错误', queued: !skipQueueOnFail };
}

async function appendSessionHistory(entry) {
    try {
        const result = await chrome.storage.local.get(SESSION_HISTORY_KEY);
        const history = result[SESSION_HISTORY_KEY] || [];
        history.unshift(entry);
        if (history.length > SESSION_HISTORY_LIMIT) {
            history.length = SESSION_HISTORY_LIMIT;
        }
        await chrome.storage.local.set({ [SESSION_HISTORY_KEY]: history });
    } catch (e) {
        console.error('写入会话历史失败:', e);
    }
}

async function getSessionHistory() {
    try {
        const result = await chrome.storage.local.get(SESSION_HISTORY_KEY);
        return result[SESSION_HISTORY_KEY] || [];
    } catch (e) {
        console.error('读取会话历史失败:', e);
        return [];
    }
}

// 队列处理互斥锁：alarm（每 1 分钟）与 popup retry 按钮可并发触发 processPendingQueue，
// 若不互斥，两个实例各自读取同一快照、各自 sendToBackend(skipDedup=true)，
// 后端收到两条相同 question_id 的 POST，wrong_count 被累加。
let isProcessingQueue = false;

async function processPendingQueue() {
    if (isProcessingQueue) {
        console.log('队列正在处理中，跳过本次触发');
        return;
    }
    isProcessingQueue = true;
    try {
        await ensureInitialized();
        const queue = await getPendingQueue();
        if (queue.length === 0) return;

        console.log(`开始处理待发送队列，共 ${queue.length} 条`);

        // 逐条原子处理：每条成功后立即按 queue_id 从 storage 移除
        // 避免 SW 中途死亡时已发条目仍留在队列，下次重发触发 UPSERT UPDATE 累加 wrong_count
        let successCount = 0;
        let failedCount = 0;
        let deadLetterCount = 0;
        const MAX_ITEM_RETRIES = 10;  // 单条最多重试 10 次，超过则视为死信移除

        for (const item of queue) {
            try {
                let result;
                if (item.type === 'session') {
                    result = await sendSessionToBackend(item.data, true, true);
                } else {
                    result = await sendToBackend(item.data, true, true);
                }

                if (result.success) {
                    successCount++;
                    // 立即从 storage 移除该条目（按 queue_id 精确定位，无索引漂移风险）
                    await removeFromPendingQueueById(item.queue_id);
                } else {
                    // 递增 retryCount，超过阈值则移除（死信），避免永久失败项无限循环
                    item.retryCount = (item.retryCount || 0) + 1;
                    if (item.retryCount >= MAX_ITEM_RETRIES) {
                        console.warn(`队列项 ${item.queue_id} 重试 ${item.retryCount} 次仍失败，移除死信:`, item.data && item.data.question_id);
                        await removeFromPendingQueueById(item.queue_id);
                        deadLetterCount++;
                    } else {
                        // 更新 retryCount 到 storage
                        await updateQueueItem(item);
                    }
                    failedCount++;
                }
            } catch (e) {
                console.error('处理队列项失败:', e);
                failedCount++;
            }
        }

        if (successCount > 0 || failedCount > 0) {
            console.log(`待发送队列处理完成：成功 ${successCount} 条，失败 ${failedCount} 条保留队列，死信 ${deadLetterCount} 条`);
        }
    } finally {
        isProcessingQueue = false;
    }
}

// 按 queue_id 从 pending_queue 中移除一条（原子操作）
async function removeFromPendingQueueById(queueId) {
    if (!queueId) return;
    try {
        const result = await chrome.storage.local.get(PENDING_QUEUE_KEY);
        const queue = result[PENDING_QUEUE_KEY] || [];
        const idx = queue.findIndex(x => x.queue_id === queueId);
        if (idx < 0) return;  // 可能已被并发移除
        queue.splice(idx, 1);
        await chrome.storage.local.set({ [PENDING_QUEUE_KEY]: queue });
    } catch (e) {
        console.error('移除队列条目失败:', e);
    }
}

// 更新队列条目的 retryCount（原子操作）
async function updateQueueItem(item) {
    if (!item || !item.queue_id) return;
    try {
        const result = await chrome.storage.local.get(PENDING_QUEUE_KEY);
        const queue = result[PENDING_QUEUE_KEY] || [];
        const idx = queue.findIndex(x => x.queue_id === item.queue_id);
        if (idx < 0) return;
        queue[idx].retryCount = item.retryCount;
        await chrome.storage.local.set({ [PENDING_QUEUE_KEY]: queue });
    } catch (e) {
        console.error('更新队列条目失败:', e);
    }
}

chrome.contextMenus.onClicked.addListener(function(info, tab) {
    if (info.menuItemId === 'collectQuestion') {
        chrome.tabs.sendMessage(tab.id, {action: 'collectCurrentQuestion'}, async function(response) {
            if (chrome.runtime.lastError) {
                console.error('发送消息失败:', chrome.runtime.lastError);
                try { chrome.tabs.sendMessage(tab.id, {action: 'showNotification', message: '采集失败：内容脚本未加载，请刷新页面', type: 'error'}); } catch (e) {}
                return;
            }
            console.log('采集结果:', response);
            if (response && response.success && response.data) {
                // 等待初始化完成，避免 SW 重启后 cachedUserId 为空导致数据落到 default_user
                await ensureInitialized();
                const result = await sendToBackend(response.data);
                // 29B: 向页面回传发送结果通知，与 popup 路径反馈体验一致
                notifyTab(tab.id, result);
            } else if (response && !response.success) {
                try { chrome.tabs.sendMessage(tab.id, {action: 'showNotification', message: '采集失败：' + (response.error || '未找到题目'), type: 'error'}); } catch (e) {}
            }
        });
    } else if (info.menuItemId === 'collectAllWrong') {
        chrome.tabs.sendMessage(tab.id, {action: 'collectAllWrongQuestions'}, function(response) {
            if (chrome.runtime.lastError) {
                console.error('发送消息失败:', chrome.runtime.lastError);
                try { chrome.tabs.sendMessage(tab.id, {action: 'showNotification', message: '采集失败：内容脚本未加载，请刷新页面', type: 'error'}); } catch (e) {}
                return;
            }
            console.log('采集所有错题结果:', response);
            // collectAllWrongQuestions 内部已通过 showNotification 展示结果，无需再重复通知
        });
    }
});

// 29B: 根据 sendToBackend 返回结果向页面发送通知
function notifyTab(tabId, result) {
    try {
        if (!result) return;
        if (result.success && !result.skipped && !result.queued) {
            chrome.tabs.sendMessage(tabId, {action: 'showNotification', message: '✓ 采集并发送成功！', type: 'success'});
        } else if (result.skipped) {
            chrome.tabs.sendMessage(tabId, {action: 'showNotification', message: '题目已采集，无需重复', type: 'info'});
        } else if (result.queued) {
            chrome.tabs.sendMessage(tabId, {action: 'showNotification', message: '网络异常，已加入待发送队列', type: 'info'});
        } else {
            chrome.tabs.sendMessage(tabId, {action: 'showNotification', message: '发送失败：' + (result.error || '未知错误'), type: 'error'});
        }
    } catch (e) {
        console.warn('发送通知到页面失败:', e);
    }
}

chrome.commands.onCommand.addListener(function(command) {
    if (command === 'collect-question') {
        console.log('快捷键触发，采集题目');

        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length === 0) {
                console.error('没有找到活动标签页');
                return;
            }

            const tab = tabs[0];

            // 与 content.js SPA 导航处理器保持一致：识别 exam/practice/test/paper/mock 等所有练习页路径
            // 旧逻辑只认 /exam，导致 /practice /paper /mock 页面快捷键静默失效，但右键菜单却能采集（不一致）
            if (!tab.url || !/ruankaodaren\.com\/(exam|practice|test|paper|mock)/i.test(tab.url)) {
                console.log('当前页面不是软考达人练习页面');
                try { chrome.tabs.sendMessage(tab.id, {action: 'showNotification', message: '当前页面不是软考达人练习页面', type: 'error'}); } catch (e) {}
                return;
            }

            chrome.tabs.sendMessage(tab.id, {action: 'collectCurrentQuestion'}, async function(response) {
                if (chrome.runtime.lastError) {
                    console.error('发送消息失败:', chrome.runtime.lastError);
                    try { chrome.tabs.sendMessage(tab.id, {action: 'showNotification', message: '采集失败：内容脚本未加载，请刷新页面', type: 'error'}); } catch (e) {}
                    return;
                }
                console.log('快捷键采集结果:', response);
                if (response && response.success && response.data) {
                    // 等待初始化完成，避免 SW 重启后 cachedUserId 为空导致数据落到 default_user
                    await ensureInitialized();
                    const result = await sendToBackend(response.data);
                    // 29B: 向页面回传发送结果通知
                    notifyTab(tab.id, result);
                } else if (response && !response.success) {
                    try { chrome.tabs.sendMessage(tab.id, {action: 'showNotification', message: '采集失败：' + (response.error || '未找到题目'), type: 'error'}); } catch (e) {}
                }
            });
        });
    }
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'sendToBackend') {
        console.log('收到发送到后端的请求:', request.data);

        ensureInitialized().then(() => sendToBackend(request.data))
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

        ensureInitialized().then(() => sendBatchToBackend(request.items))
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
        // B5: 使用 AbortController 3 秒超时，避免后端不可达时 popup 长时间等待
        const controller = new AbortController();
        const timeoutId = setTimeout(function() { controller.abort(); }, 3000);
        fetch(API_URL.replace('/wrong-questions', '/health'), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal
        })
        .then(response => {
            clearTimeout(timeoutId);
            sendResponse({ online: response.ok });
        })
        .catch(() => {
            clearTimeout(timeoutId);
            sendResponse({ online: false });
        });
        return true;
    } else if (request.action === 'loadStats') {
        // popup 通过 background 中转拉取统计，避免 popup 直接跨域请求
        // 必须携带 user_id，否则后端返回 default_user 的统计，与采集的数据脱节
        const statsUrl = API_URL.replace('/wrong-questions', '/stats/overview') +
                         '?user_id=' + encodeURIComponent(getUserId());
        fetch(statsUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            sendResponse({ success: true, data: data });
        })
        .catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    } else if (request.action === 'sendSession') {
        console.log('收到练习会话发送请求:', request.data && request.data.paper_name);
        ensureInitialized().then(() => sendSessionToBackend(request.data))
            .then(result => {
                sendResponse(result);
            })
            .catch(error => {
                console.error('练习会话发送异常:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (request.action === 'getSessionHistory') {
        getSessionHistory().then(history => {
            sendResponse({ success: true, items: history });
        }).catch(error => {
            sendResponse({ success: false, error: error.message, items: [] });
        });
        return true;
    }

    // B4: 未知 action 显式返回错误，避免调用方一直等待响应（导致 callback 永不触发）
    console.warn('收到未知 action:', request.action);
    sendResponse({ success: false, error: 'Unknown action: ' + (request.action || '(empty)') });
    return false;
});

console.log('Background script loaded');
