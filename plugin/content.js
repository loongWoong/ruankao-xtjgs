const QUESTION_TITLE_SELECTORS = [
    '#answerInfotitle',
    '.answerInfotitle',
    '[id*="answerInfotitle"]',
    '.question-title',
    '.questionTitle',
    '.exam-question-title',
    '[class*="question-title"]',
    '[class*="QuestionTitle"]'
];

const OPTIONS_SELECTORS = [
    '.questionaw',
    '.question-options',
    '.options-container',
    '.exam-options',
    '.answer-options',
    '[class*="question-options"]',
    '[class*="QuestionOptions"]',
    '[class*="option-list"]',
    '[class*="OptionList"]'
];

// 选项内部条目选择器（用于遍历每个选项节点）
const OPTION_ITEM_SELECTORS = '.options, .aWFalse, .aWtrue, .option-item, [class*="option-item"], .exam-option, [class*="exam-option"], .answer-option, [class*="answer-option"]';
// 选项标签（A/B/C/D）选择器
const OPTION_LABEL_SELECTORS = '.awoption, .option-label, [class*="option-label"], [class*="OptionLabel"]';
// 选项内容选择器
const OPTION_CONTENT_SELECTORS = '.content .ql-editor, .option-content, [class*="option-content"], [class*="OptionContent"]';

const ANSWER_SELECTORS = [
    '.answer-to-the-question',
    '.question-answer',
    '.answer-section',
    '[class*="answer-to"]',
    '[class*="question-answer"]'
];

const ANALYSIS_SELECTORS = [
    '.right-key.paddlr.lgccquestfont1',
    '.question-analysis',
    '.analysis-section',
    '.answer-analysis',
    '[class*="question-analysis"]',
    '[class*="answer-analysis"]'
];

const QUESTION_CONTAINER_SELECTORS = [
    '[class*="question"]',
    '[class*="Question"]',
    '[class*="item"]',
    '[class*="card"]',
    '[class*="exercise"]',
    '.question-item',
    '.exercise-item',
    '.wrong-question-item',
    '.question-card',
    '.exam-question',
    '[class*="question-item"]',
    '[class*="QuestionItem"]',
    '[class*="wrong-question"]'
];

let currentQuestionHash = '';
let observer = null;

function collectCurrentQuestion() {
    try {
        console.log('开始采集题目信息');

        const questionElement = findQuestionTitleElement();
        if (!questionElement) {
            console.error('未找到题目元素');
            throw new Error('未找到题目元素');
        }

        let questionText = '';

        try {
            questionText = extractQuestionText(questionElement);
        } catch (e) {
            console.error('提取题目文本失败:', e);
        }

        if (!questionText) {
            throw new Error('未找到题目内容');
        }

        console.log('提取的题目:', questionText);

        let category = '';
        try {
            category = extractCategory(questionElement);
        } catch (e) {
            console.warn('提取分类失败:', e);
        }
        console.log('分类:', category);

        let options = [];
        try {
            options = extractOptions(questionElement);
        } catch (e) {
            console.warn('提取选项失败:', e);
        }
        console.log('找到选项数量:', options.length);

        let correctAnswer = '';
        let userAnswer = '';
        try {
            const answers = extractAnswers(questionElement);
            correctAnswer = answers.correctAnswer;
            userAnswer = answers.userAnswer;
        } catch (e) {
            console.warn('提取答案失败:', e);
        }
        console.log('正确答案:', correctAnswer, '用户答案:', userAnswer);

        let analysis = '';
        try {
            analysis = extractAnalysis(questionElement);
        } catch (e) {
            console.warn('提取解析失败:', e);
        }
        console.log('解析:', analysis);

        const questionData = {
            question_id: generateQuestionId(questionText),
            question: questionText,
            options: options,
            correct_answer: correctAnswer,
            user_answer: userAnswer,
            category: category,
            analysis: analysis,
            source_url: window.location.href  // 记录题目来源页，便于追溯
        };

        console.log('采集的数据:', JSON.stringify(questionData, null, 2));

        return { success: true, data: questionData, pendingSend: true };
    } catch (error) {
        console.error('采集题目失败:', error);
        return { success: false, error: error.message };
    }
}

function generateQuestionId(questionText) {
    let hash = 0;
    const text = questionText.replace(/\s+/g, '').substring(0, 100);
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    // 只基于题目文本哈希，不加 Date.now()，保证同一道题每次生成相同 ID
    // 后端据此做 UPSERT 去重，避免重复采集
    return 'q_' + Math.abs(hash);
}

function findQuestionTitleElement() {
    for (const selector of QUESTION_TITLE_SELECTORS) {
        try {
            const el = document.querySelector(selector);
            if (el && el.textContent && el.textContent.trim().length > 10) {
                return el;
            }
        } catch (e) {
            continue;
        }
    }
    return null;
}

function extractQuestionText(questionElement) {
    let questionText = '';

    try {
        const children = questionElement.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (!child.className || !child.className.includes('secondChapterName')) {
                const text = child.textContent.trim();
                if (text && text.length > 10) {
                    questionText = text;
                    break;
                }
            }
        }
    } catch (e) {
        console.warn('通过子元素提取题目失败:', e);
    }

    if (!questionText) {
        try {
            if (questionElement.firstElementChild) {
                const text = questionElement.firstElementChild.textContent.trim();
                if (text && text.length > 10) {
                    questionText = text;
                }
            }
        } catch (e) {
            console.warn('通过firstElementChild提取题目失败:', e);
        }
    }

    if (!questionText) {
        try {
            const text = questionElement.textContent.trim();
            if (text && text.length > 10) {
                questionText = text;
            }
        } catch (e) {
            console.warn('直接提取textContent失败:', e);
        }
    }

    if (questionText) {
        questionText = questionText.replace(/\s+/g, ' ').trim();
    }

    return questionText;
}

function extractCategory(questionElement) {
    try {
        const categoryElement = questionElement.querySelector('.secondChapterName');
        return categoryElement ? categoryElement.textContent.trim() : '';
    } catch (e) {
        return '';
    }
}

function extractOptions(questionElement) {
    const options = [];

    const container = findParentBySelectors(questionElement, OPTIONS_SELECTORS) || findOptionsElementNearby(questionElement);
    if (!container) {
        return options;
    }

    try {
        const optionElements = container.querySelectorAll(OPTION_ITEM_SELECTORS);
        optionElements.forEach((optionElement) => {
            try {
                const optionLabelElement = optionElement.querySelector(OPTION_LABEL_SELECTORS);
                const contentElement = optionElement.querySelector(OPTION_CONTENT_SELECTORS);
                if (optionLabelElement && contentElement) {
                    const optionLabel = optionLabelElement.textContent.trim();
                    const optionContent = contentElement.textContent.trim();
                    options.push(`${optionLabel} ${optionContent}`);
                } else {
                    // 降级：直接取整段文本作为选项（标签与内容未分离时）
                    const fullText = optionElement.textContent.trim();
                    if (fullText && fullText.length > 0 && fullText.length < 200) {
                        options.push(fullText);
                    }
                }
            } catch (e) {
                console.warn('提取单个选项失败:', e);
            }
        });
    } catch (e) {
        console.warn('提取选项列表失败:', e);
    }

    return options;
}

function findOptionsElementNearby(questionElement) {
    try {
        let el = questionElement.nextElementSibling;
        while (el) {
            for (const selector of OPTIONS_SELECTORS) {
                if (el.matches(selector)) {
                    return el;
                }
            }
            const found = el.querySelector(OPTIONS_SELECTORS.join(','));
            if (found) return found;
            el = el.nextElementSibling;
        }

        el = questionElement.parentElement;
        let depth = 0;
        while (el && depth < 5) {
            for (const selector of OPTIONS_SELECTORS) {
                const found = el.querySelector(selector);
                if (found) return found;
            }
            el = el.parentElement;
            depth++;
        }
    } catch (e) {
        console.warn('查找选项元素失败:', e);
    }
    return null;
}

function findParentBySelectors(element, selectors) {
    try {
        let el = element.parentElement;
        let depth = 0;
        while (el && depth < 10) {
            for (const selector of selectors) {
                if (el.matches(selector)) {
                    return el;
                }
            }
            el = el.parentElement;
            depth++;
        }
    } catch (e) {
        return null;
    }
    return null;
}

function extractAnswers(questionElement) {
    let correctAnswer = '';
    let userAnswer = '';

    try {
        const answerElement = findAnswerElement(questionElement);
        if (answerElement) {
            const rightKeyElements = answerElement.querySelectorAll('.right-key, [class*="right-key"]');
            rightKeyElements.forEach(el => {
                try {
                    const text = el.textContent.trim();
                    // 同时兼容全角"："与半角":"，并兼容"正确答案"/"你的答案"前后可能出现的空白
                    const correctMatch = text.match(/正确答案\s*[：:]\s*([A-Za-z0-9,，、\s]+)/);
                    const userMatch = text.match(/你的答案\s*[：:]\s*([A-Za-z0-9,，、\s]+)/);
                    if (correctMatch) {
                        correctAnswer = correctMatch[1].trim();
                    } else if (text.includes('正确答案')) {
                        // 兜底：仅有"正确答案"字样但无冒号的情况
                        correctAnswer = text.replace(/正确答案/, '').replace(/^[：:\s]+/, '').trim();
                    }
                    if (userMatch) {
                        userAnswer = userMatch[1].trim();
                    } else if (text.includes('你的答案')) {
                        userAnswer = text.replace(/你的答案/, '').replace(/^[：:\s]+/, '').trim();
                    }
                } catch (e) {
                }
            });
        }
    } catch (e) {
        console.warn('提取答案失败:', e);
    }

    return { correctAnswer, userAnswer };
}

function findAnswerElement(questionElement) {
    try {
        let el = questionElement.parentElement;
        let depth = 0;
        while (el && depth < 10) {
            for (const selector of ANSWER_SELECTORS) {
                const found = el.querySelector(selector);
                if (found) return found;
            }
            el = el.parentElement;
            depth++;
        }
    } catch (e) {
        return null;
    }
    return null;
}

function extractAnalysis(questionElement) {
    try {
        let el = questionElement.parentElement;
        let depth = 0;
        while (el && depth < 10) {
            for (const selector of ANALYSIS_SELECTORS) {
                const found = el.querySelector(selector);
                if (found && found.textContent.trim().length > 5) {
                    return found.textContent.trim();
                }
            }
            el = el.parentElement;
            depth++;
        }
    } catch (e) {
        console.warn('提取解析失败:', e);
    }
    return '';
}

function collectQuestionElement(questionEl) {
    try {
        const questionTitleEl = findQuestionTitleInElement(questionEl);
        if (!questionTitleEl) {
            return null;
        }

        let questionText = '';
        try {
            questionText = extractQuestionText(questionTitleEl);
        } catch (e) {
            console.warn('提取题目文本失败:', e);
        }

        if (!questionText) {
            return null;
        }

        let category = '';
        try {
            category = extractCategory(questionTitleEl);
        } catch (e) {
        }

        let options = [];
        try {
            const optionsContainer = questionEl.querySelector(OPTIONS_SELECTORS.join(','));
            if (optionsContainer) {
                const optionElements = optionsContainer.querySelectorAll(OPTION_ITEM_SELECTORS);
                optionElements.forEach((optionElement) => {
                    try {
                        const optionLabelElement = optionElement.querySelector(OPTION_LABEL_SELECTORS);
                        const contentElement = optionElement.querySelector(OPTION_CONTENT_SELECTORS);
                        if (optionLabelElement && contentElement) {
                            const optionLabel = optionLabelElement.textContent.trim();
                            const optionContent = contentElement.textContent.trim();
                            options.push(`${optionLabel} ${optionContent}`);
                        } else {
                            const fullText = optionElement.textContent.trim();
                            if (fullText && fullText.length > 0 && fullText.length < 200) {
                                options.push(fullText);
                            }
                        }
                    } catch (e) {
                    }
                });
            }
        } catch (e) {
            console.warn('提取选项失败:', e);
        }

        let correctAnswer = '';
        let userAnswer = '';
        try {
            const answers = extractAnswers(questionTitleEl);
            correctAnswer = answers.correctAnswer;
            userAnswer = answers.userAnswer;
        } catch (e) {
        }

        let analysis = '';
        try {
            analysis = extractAnalysis(questionTitleEl);
        } catch (e) {
        }

        return {
            question_id: generateQuestionId(questionText),
            question: questionText,
            options: options,
            correct_answer: correctAnswer,
            user_answer: userAnswer,
            category: category,
            analysis: analysis,
            source_url: window.location.href  // 记录题目来源页，便于追溯
        };
    } catch (error) {
        console.error('采集单道题目失败:', error);
        return null;
    }
}

function findQuestionTitleInElement(container) {
    for (const selector of QUESTION_TITLE_SELECTORS) {
        try {
            const el = container.querySelector(selector);
            if (el && el.textContent && el.textContent.trim().length > 10) {
                return el;
            }
        } catch (e) {
            continue;
        }
    }
    return null;
}

async function collectAllWrongQuestions() {
    try {
        console.log('开始采集所有可见错题');

        let questionElements = [];

        try {
            const titleElements = document.querySelectorAll(QUESTION_TITLE_SELECTORS.join(','));
            if (titleElements.length > 0) {
                for (const titleEl of titleElements) {
                    let container = null;
                    try {
                        container = titleEl.closest(QUESTION_CONTAINER_SELECTORS.join(','));
                    } catch (e) {
                    }
                    if (!container) {
                        container = titleEl.parentElement;
                        try {
                            while (container && container.parentElement && container.children.length < 3) {
                                container = container.parentElement;
                            }
                        } catch (e) {
                        }
                    }
                    if (container && !questionElements.includes(container)) {
                        questionElements.push(container);
                    }
                }
            }
        } catch (e) {
            console.warn('通过标题元素查找题目容器失败:', e);
        }

        if (questionElements.length <= 1) {
            try {
                for (const selector of QUESTION_CONTAINER_SELECTORS) {
                    const els = document.querySelectorAll(selector);
                    if (els.length > 1) {
                        questionElements = Array.from(els);
                        break;
                    }
                }
            } catch (e) {
                console.warn('通过容器选择器查找失败:', e);
            }
        }

        if (questionElements.length === 0) {
            const singleQuestion = findQuestionTitleElement();
            if (singleQuestion) {
                const result = collectCurrentQuestion();
                return result;
            }
            throw new Error('未找到任何题目元素，请确保在错题列表或答题页面');
        }

        console.log(`找到 ${questionElements.length} 道题目`);

        // 阶段一：逐题采集 DOM 数据（不发网络请求，提升批量效率）
        const collectedQuestions = [];
        let collectFailCount = 0;

        for (let i = 0; i < questionElements.length; i++) {
            const questionEl = questionElements[i];
            const questionData = collectQuestionElement(questionEl);

            if (questionData) {
                collectedQuestions.push(questionData);
            } else {
                collectFailCount++;
            }

            try {
                sendProgressUpdate(i + 1, questionElements.length, collectedQuestions.length, collectFailCount);
            } catch (e) {
            }

            try {
                showNotification(`采集中... ${i + 1}/${questionElements.length}`, 'info');
            } catch (e) {
            }
        }

        // 阶段二：批量发送到后端（一次请求，单连接提交）
        let successCount = 0;
        let failCount = collectFailCount;
        let batchResult = null;

        if (collectedQuestions.length > 0) {
            try {
                showNotification(`正在批量发送 ${collectedQuestions.length} 道题目...`, 'info');
                batchResult = await sendBatchToBackendViaBackgroundAsync(collectedQuestions);
                // inserted + updated 均视为发送成功
                successCount = (batchResult.inserted || 0) + (batchResult.updated || 0);
                failCount += batchResult.failed || 0;
                if (batchResult.queued > 0) {
                    try {
                        showNotification(`${batchResult.queued} 道已加入离线队列`, 'info');
                    } catch (e) {
                    }
                }
            } catch (e) {
                console.error('批量发送失败:', e);
                failCount += collectedQuestions.length;
            }
        }

        const resultMsg = `采集完成：成功 ${successCount} 道，失败 ${failCount} 道` +
            (batchResult && batchResult.queued ? `，离线队列 ${batchResult.queued} 道` : '');
        console.log(resultMsg);
        try {
            showNotification(resultMsg, successCount > 0 ? 'success' : 'error');
        } catch (e) {
        }

        return {
            success: successCount > 0,
            total: questionElements.length,
            successCount: successCount,
            failCount: failCount,
            inserted: batchResult ? batchResult.inserted : 0,
            updated: batchResult ? batchResult.updated : 0,
            queued: batchResult ? batchResult.queued : 0,
            data: collectedQuestions
        };
    } catch (error) {
        console.error('采集所有错题失败:', error);
        return { success: false, error: error.message };
    }
}

function sendProgressUpdate(current, total, success, fail) {
    try {
        chrome.runtime.sendMessage({
            action: 'collectProgress',
            progress: {
                current: current,
                total: total,
                success: success,
                fail: fail
            }
        });
    } catch (e) {
    }
}

function sendToBackendViaBackgroundAsync(data) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage({
                action: 'sendToBackend',
                data: data
            }, function(response) {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response && response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response ? response.error : '未知错误'));
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

function sendBatchToBackendViaBackgroundAsync(items) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage({
                action: 'sendBatchToBackend',
                items: items
            }, function(response) {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                // 批量接口即使部分失败也返回 success（已尽力发送，失败入队）
                if (response) {
                    resolve(response);
                } else {
                    reject(new Error('批量发送无响应'));
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

function sendToBackendViaBackground(data) {
    console.log('通过background script发送数据');

    try {
        chrome.runtime.sendMessage({
            action: 'sendToBackend',
            data: data
        }, function(response) {
            if (chrome.runtime.lastError) {
                console.error('发送失败:', chrome.runtime.lastError);
                showNotification('发送失败：' + chrome.runtime.lastError.message, 'error');
                return;
            }
            console.log('发送成功:', response);
            if (response && response.skipped) {
                showNotification('题目已采集，无需重复', 'info');
            } else if (response && response.queued) {
                showNotification('网络异常，已加入待发送队列', 'info');
            } else {
                showNotification('采集成功！', 'success');
            }
        });
    } catch (e) {
        console.error('发送异常:', e);
        showNotification('发送失败：' + e.message, 'error');
    }
}

function showNotification(message, type) {
    try {
        const existing = document.getElementById('plugin-notification-' + type);
        if (existing) {
            existing.remove();
        }

        const notification = document.createElement('div');
        notification.id = 'plugin-notification-' + type;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 25px;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: Arial, sans-serif;
            font-size: 14px;
            animation: slideIn 0.3s ease;
            max-width: 300px;
            word-wrap: break-word;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);

        if (!document.getElementById('plugin-notification-style')) {
            const style = document.createElement('style');
            style.id = 'plugin-notification-style';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }

        setTimeout(() => {
            try {
                notification.remove();
            } catch (e) {
            }
        }, 3000);
    } catch (e) {
        console.error('显示通知失败:', e);
    }
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    console.log('content.js收到消息:', request);

    if (request.action === 'collectCurrentQuestion') {
        const result = collectCurrentQuestion();
        sendResponse(result);
    } else if (request.action === 'collectAllWrongQuestions') {
        collectAllWrongQuestions().then(result => {
            sendResponse(result);
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    return true;
});

document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        console.log('快捷键 Ctrl+Shift+C 被触发');
        e.preventDefault();
        const result = collectCurrentQuestion();
        if (result.success && result.data) {
            sendToBackendViaBackground(result.data);
        } else if (!result.success) {
            showNotification('采集失败：' + result.error, 'error');
        }
    }
});

function getCurrentQuestionHash() {
    try {
        const el = findQuestionTitleElement();
        if (el) {
            const text = el.textContent.trim().substring(0, 50);
            return text;
        }
    } catch (e) {
    }
    return '';
}

function checkNewQuestion() {
    try {
        const newHash = getCurrentQuestionHash();
        if (newHash && newHash !== currentQuestionHash) {
            currentQuestionHash = newHash;
            console.log('检测到新题目出现');
            showNotification('检测到新题目，按 Ctrl+Shift+C 可采集', 'info');
        }
    } catch (e) {
        console.warn('检查新题目失败:', e);
    }
}

function initMutationObserver() {
    try {
        if (observer) {
            observer.disconnect();
        }

        observer = new MutationObserver(function(mutations) {
            let shouldCheck = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    shouldCheck = true;
                    break;
                }
            }
            if (shouldCheck) {
                checkNewQuestion();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('DOM观察器已启动');
    } catch (e) {
        console.error('初始化DOM观察器失败:', e);
    }
}

console.log('软考达人错题采集插件已加载');
console.log('提示：按 Ctrl+Shift+C 可快速采集当前题目');

currentQuestionHash = getCurrentQuestionHash();
initMutationObserver();
