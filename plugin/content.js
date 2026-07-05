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

// 精确容器选择器（用于 .closest() 定位单题容器，避免匹配到外层列表）
const QUESTION_CONTAINER_PRECISE = [
    '.question-item',
    '.exercise-item',
    '.wrong-question-item',
    '.question-card',
    '.exam-question',
    '[class*="question-item"]',
    '[class*="QuestionItem"]',
    '[class*="wrong-question"]',
    '[class*="exercise-item"]',
    '[class*="ExamQuestion"]'
];

// 宽泛容器选择器（仅作回退，且会做包含关系去重）
const QUESTION_CONTAINER_SELECTORS = [
    '.question-item',
    '.exercise-item',
    '.wrong-question-item',
    '.question-card',
    '.exam-question',
    '[class*="question-item"]',
    '[class*="QuestionItem"]',
    '[class*="wrong-question"]',
    '[class*="exercise"]',
    '[class*="card"]'
];

// 题干提取时应排除的类名（避免误取章节名/题型说明/面包屑等）
const QUESTION_TEXT_EXCLUDE_CLASSES = [
    'secondChapterName',
    'breadcrumb',
    'nav',
    'question-type',
    'question-number',
    'questionType',
    'questionNumber',
    'question-meta',
    'questionMeta'
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

        // 数据质量校验：题干过短 或 既无正确答案也无用户答案时，标记为低质量
        const warnings = [];
        if (questionText.length < 10) {
            warnings.push('题干过短');
        }
        if (!correctAnswer && !userAnswer) {
            warnings.push('未识别到答案（可能在答题中，建议交卷后采集）');
        }
        if (options.length === 0) {
            warnings.push('未识别到选项');
        }

        return { success: true, data: questionData, pendingSend: true, warnings: warnings };
    } catch (error) {
        console.error('采集题目失败:', error);
        return { success: false, error: error.message };
    }
}

function generateQuestionId(questionText) {
    // 使用双哈希降低碰撞概率：32 位 DJP 哈希约 4.6 万题有 50% 碰撞，
    // 双哈希拼接（两个不同 seed）将碰撞空间扩大到 ~2^64，足够软考场景使用。
    // 只基于题目文本，不加 Date.now()，保证同一道题每次生成相同 ID（后端 UPSERT 去重依赖）。
    const text = questionText.replace(/\s+/g, '').substring(0, 200);

    const djb2Hash = function(seed) {
        let h = seed;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            h = ((h << 5) + h) + char;  // h * 33 + char
            h = h & h;  // 32 位
        }
        return Math.abs(h);
    };

    const h1 = djb2Hash(5381);
    const h2 = djb2Hash(16777619);
    return 'q_' + h1.toString(36) + '_' + h2.toString(36);
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

    // 判断子元素是否应被排除（基于类名）
    const shouldExclude = function(el) {
        try {
            const cls = el.className || '';
            if (typeof cls !== 'string') return false;
            for (const excludeClass of QUESTION_TEXT_EXCLUDE_CLASSES) {
                if (cls.includes(excludeClass)) return true;
            }
        } catch (e) {
        }
        return false;
    };

    try {
        const children = questionElement.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (shouldExclude(child)) continue;
            const text = child.textContent.trim();
            // 跳过过短文本（<10）和过长文本（>500，可能是选项/解析混入）
            if (text && text.length >= 10 && text.length <= 500) {
                questionText = text;
                break;
            }
        }
    } catch (e) {
        console.warn('通过子元素提取题目失败:', e);
    }

    if (!questionText) {
        try {
            if (questionElement.firstElementChild && !shouldExclude(questionElement.firstElementChild)) {
                const text = questionElement.firstElementChild.textContent.trim();
                if (text && text.length >= 10 && text.length <= 500) {
                    questionText = text;
                }
            }
        } catch (e) {
            console.warn('通过firstElementChild提取题目失败:', e);
        }
    }

    if (!questionText) {
        // 第三级 fallback：不再取整个 textContent（会混入选项/答案），改为取直接子文本节点拼接
        try {
            let directText = '';
            for (let node of questionElement.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    directText += node.textContent;
                }
            }
            directText = directText.trim();
            if (directText.length >= 10) {
                questionText = directText;
            }
        } catch (e) {
            console.warn('提取直接文本节点失败:', e);
        }
    }

    if (questionText) {
        // 净化：去除多余空白、前导题号（如 "1. " "第1题"）
        questionText = questionText.replace(/\s+/g, ' ').trim();
        questionText = questionText.replace(/^(?:第?\d+[题.、:：]\s*)/, '');
    }

    return questionText;
}

function extractCategory(questionElement) {
    try {
        const categoryElement = questionElement.querySelector('.secondChapterName');
        const raw = categoryElement ? categoryElement.textContent.trim() : '';
        return normalizeCategory(raw);
    } catch (e) {
        return '';
    }
}

// 标准化分类名：去除"第X章""X."等前缀，截断过长名称
function normalizeCategory(raw) {
    if (!raw) return '';
    let s = raw.trim();
    // 去除 "第一章" / "第1章" / "第十二章" 等前缀
    s = s.replace(/^第[一二三四五六七八九十百\d]+[章节卷篇部分]\s*/, '');
    // 去除 "1." / "1、" / "1:" 等数字前缀
    s = s.replace(/^\d+[.、:：]\s*/, '');
    // 去除多余空白
    s = s.replace(/\s+/g, ' ').trim();
    // 截断过长名称（限 50 字符）
    if (s.length > 50) {
        s = s.substring(0, 50);
    }
    return s;
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

// DOM 包含关系去重：若 A 包含 B（A 是 B 的祖先），则移除 A，保留更具体的 B
function deduplicateByContainment(elements) {
    const result = [];
    for (let i = 0; i < elements.length; i++) {
        const a = elements[i];
        let isAncestor = false;
        for (let j = 0; j < elements.length; j++) {
            if (i === j) continue;
            const b = elements[j];
            // 若 a 包含 b 且 a !== b，则 a 是祖先，移除 a
            if (a !== b && a.contains && a.contains(b)) {
                isAncestor = true;
                break;
            }
        }
        if (!isAncestor) {
            result.push(a);
        }
    }
    return result;
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
                        // 优先用精确选择器定位单题容器，避免匹配到外层列表容器
                        container = titleEl.closest(QUESTION_CONTAINER_PRECISE.join(','));
                    } catch (e) {
                    }
                    if (!container) {
                        // 回退：向上找直到容器包含选项或答案区（说明是完整题目）
                        container = titleEl.parentElement;
                        try {
                            while (container && container.parentElement) {
                                if (container.querySelector(OPTIONS_SELECTORS.join(',')) ||
                                    container.querySelector('.right-key, [class*="right-key"]')) {
                                    break;
                                }
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

        // 仅在标题查找完全失败时才回退到宽泛选择器（避免覆盖已找到的正确结果）
        if (questionElements.length === 0) {
            try {
                for (const selector of QUESTION_CONTAINER_SELECTORS) {
                    const els = document.querySelectorAll(selector);
                    if (els.length > 0) {
                        questionElements = Array.from(els);
                        break;
                    }
                }
                // DOM 包含关系去重：若 A 是 B 的祖先，移除 A（避免父子容器都匹配）
                questionElements = deduplicateByContainment(questionElements);
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

// 练习会话结果汇总选择器（覆盖软考达人常见结果页 DOM 结构）
const SESSION_PAPER_NAME_SELECTORS = [
    '.paper-title', '.exam-title', '.paper-name', '.exam-name',
    '[class*="paper-title"]', '[class*="exam-title"]', '[class*="paperName"]',
    'h1', 'h2', '.title'
];
const SESSION_SCORE_SELECTORS = [
    '.total-score', '.exam-score', '.score-value', '.final-score',
    '[class*="total-score"]', '[class*="exam-score"]', '[class*="scoreValue"]',
    '[class*="finalScore"]'
];
const SESSION_SUMMARY_SELECTORS = [
    '.result-summary', '.score-summary', '.exam-result', '.result-info',
    '.practice-summary', '[class*="result-summary"]', '[class*="scoreSummary"]',
    '[class*="examResult"]', '[class*="practiceSummary"]'
];

function collectPracticeSession() {
    try {
        console.log('开始采集练习会话结果');

        // 1. 试卷名称
        let paperName = '';
        for (const selector of SESSION_PAPER_NAME_SELECTORS) {
            try {
                const el = document.querySelector(selector);
                if (el && el.textContent && el.textContent.trim().length > 0 && el.textContent.trim().length < 200) {
                    paperName = el.textContent.trim();
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        // 兜底：用 document.title
        if (!paperName) {
            paperName = document.title || '';
        }

        // 2. 从汇总区提取得分/正确数/错误数/总数/用时
        let summaryText = '';
        let summaryEl = null;
        for (const selector of SESSION_SUMMARY_SELECTORS) {
            try {
                const el = document.querySelector(selector);
                if (el && el.textContent && el.textContent.trim().length > 5) {
                    summaryEl = el;
                    summaryText = el.textContent.trim();
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        // 兜底：整页 body 文本用于正则提取
        if (!summaryText) {
            summaryText = document.body ? document.body.innerText.substring(0, 5000) : '';
        }

        // 3. 正则提取各数值字段（兼容多种表述）
        // 得分：支持 "得分: 85" / "总分: 100" / "成绩: 85分"
        let score = 0;
        const scoreMatch = summaryText.match(/(?:得分|成绩|分数)\s*[：:]\s*(\d+(?:\.\d+)?)\s*分?/) ||
                          summaryText.match(/(?:score)\s*[：:]\s*(\d+(?:\.\d+)?)/i);
        if (scoreMatch) {
            score = parseFloat(scoreMatch[1]) || 0;
        }

        // 总题数：支持 "总题数: 75" / "共 75 题" / "题目总数: 75"
        let totalQuestions = 0;
        const totalMatch = summaryText.match(/(?:总题数|题目总数|共)\s*[：:]?\s*(\d+)\s*题?/) ||
                           summaryText.match(/(?:total)\s*[：:]\s*(\d+)/i);
        if (totalMatch) {
            totalQuestions = parseInt(totalMatch[1], 10) || 0;
        }

        // 正确数
        let correctCount = 0;
        const correctMatch = summaryText.match(/(?:正确数|答对|正确)\s*[：:]\s*(\d+)\s*题?/) ||
                             summaryText.match(/(?:correct)\s*[：:]\s*(\d+)/i);
        if (correctMatch) {
            correctCount = parseInt(correctMatch[1], 10) || 0;
        }

        // 错误数
        let wrongCount = 0;
        const wrongMatch = summaryText.match(/(?:错误数|答错|错误|错题)\s*[：:]\s*(\d+)\s*题?/) ||
                           summaryText.match(/(?:wrong|incorrect)\s*[：:]\s*(\d+)/i);
        if (wrongMatch) {
            wrongCount = parseInt(wrongMatch[1], 10) || 0;
        }

        // 用时：支持 "用时: 90分钟" / "耗时: 1小时30分" / "时间: 5400秒"
        let timeSpent = 0;
        const timeMatch1 = summaryText.match(/(?:用时|耗时|时间)\s*[：:]\s*(\d+)\s*分钟?/);
        const timeMatch2 = summaryText.match(/(?:用时|耗时|时间)\s*[：:]\s*(\d+)\s*小时\s*(\d+)?\s*分钟?/);
        const timeMatch3 = summaryText.match(/(?:用时|耗时|时间)\s*[：:]\s*(\d+)\s*秒/);
        if (timeMatch2) {
            timeSpent = (parseInt(timeMatch2[1], 10) || 0) * 60 + (parseInt(timeMatch2[2] || '0', 10) || 0);
        } else if (timeMatch1) {
            timeSpent = parseInt(timeMatch1[1], 10) || 0;
        } else if (timeMatch3) {
            timeSpent = Math.round((parseInt(timeMatch3[1], 10) || 0) / 60);
        }

        // 正确率：若未直接采集到，且 total>0，则用 correct/total 推算
        let accuracy = 0;
        const accuracyMatch = summaryText.match(/(?:正确率|准确率|通过率)\s*[：:]\s*(\d+(?:\.\d+)?)\s*%?/);
        if (accuracyMatch) {
            accuracy = parseFloat(accuracyMatch[1]) || 0;
            // 若 > 1，视为百分制，归一化到 0-1
            if (accuracy > 1) {
                accuracy = accuracy / 100;
            }
        } else if (totalQuestions > 0 && correctCount > 0) {
            accuracy = correctCount / totalQuestions;
        }

        // 总题数兜底：若未匹配到，但 correct+wrong>0，则用其和
        if (totalQuestions <= 0 && (correctCount + wrongCount) > 0) {
            totalQuestions = correctCount + wrongCount;
        }

        // 4. 校验：至少要有总题数或得分之一
        if (totalQuestions <= 0 && score <= 0) {
            return {
                success: false,
                error: '未识别到练习结果汇总信息（需在交卷结果页使用）'
            };
        }

        const sessionData = {
            paper_name: paperName,
            total_questions: totalQuestions,
            correct_count: correctCount,
            wrong_count: wrongCount,
            score: score,
            accuracy: accuracy,
            time_spent: timeSpent,
            source_url: window.location.href,
            submitted_at: new Date().toISOString(),
            raw_data: {
                title: document.title,
                summary_text: summaryText.substring(0, 1000)
            }
        };

        console.log('采集的练习会话:', JSON.stringify(sessionData, null, 2));
        return { success: true, data: sessionData };
    } catch (error) {
        console.error('采集练习会话失败:', error);
        return { success: false, error: error.message };
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
    } else if (request.action === 'collectPracticeSession') {
        const result = collectPracticeSession();
        sendResponse(result);
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

// 检测答案是否已揭示（.right-key 出现意味着已交卷/查看解析）
let answerRevealed = false;
function checkAnswerRevealed() {
    try {
        const rightKeyEl = document.querySelector('.right-key, [class*="right-key"]');
        if (rightKeyEl && rightKeyEl.textContent.trim().length > 0) {
            if (!answerRevealed) {
                answerRevealed = true;
                console.log('检测到答案已揭示');
                showNotification('答案已揭示，按 Ctrl+Shift+C 采集本题', 'info');
            }
        } else {
            // 答案区消失（切到新题），重置标志
            answerRevealed = false;
        }
    } catch (e) {
        console.warn('检查答案揭示失败:', e);
    }
}

function initMutationObserver() {
    try {
        if (observer) {
            observer.disconnect();
        }

        observer = new MutationObserver(function(mutations) {
            let shouldCheckQuestion = false;
            let shouldCheckAnswer = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    shouldCheckQuestion = true;
                    // 检查新增节点是否包含答案区
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            if (node.matches && (node.matches('.right-key, [class*="right-key"]') ||
                                node.querySelector && node.querySelector('.right-key, [class*="right-key"]'))) {
                                shouldCheckAnswer = true;
                                break;
                            }
                        }
                    }
                }
            }
            if (shouldCheckQuestion) {
                checkNewQuestion();
            }
            if (shouldCheckAnswer) {
                checkAnswerRevealed();
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

// SPA 导航处理：ruankaodaren 可能为单页应用，URL 变化时不重新加载页面
// 监听 pushState/replaceState/popstate，URL 变化后重置采集状态
let lastUrl = window.location.href;
function setupSpaNavigationHandler() {
    try {
        const onUrlChange = function() {
            const newUrl = window.location.href;
            if (newUrl !== lastUrl) {
                console.log('检测到 URL 变化:', lastUrl, '->', newUrl);
                lastUrl = newUrl;
                // 重置采集状态，等待新页面 DOM 渲染后再检测
                currentQuestionHash = '';
                answerRevealed = false;
                setTimeout(function() {
                    currentQuestionHash = getCurrentQuestionHash();
                    checkAnswerRevealed();
                }, 1500);
            }
        };

        // 劫持 history.pushState / replaceState
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        history.pushState = function() {
            const result = originalPushState.apply(this, arguments);
            onUrlChange();
            return result;
        };
        history.replaceState = function() {
            const result = originalReplaceState.apply(this, arguments);
            onUrlChange();
            return result;
        };
        window.addEventListener('popstate', onUrlChange);

        console.log('SPA 导航处理器已启动');
    } catch (e) {
        console.error('初始化 SPA 导航处理器失败:', e);
    }
}

console.log('软考达人错题采集插件已加载');
console.log('提示：按 Ctrl+Shift+C 可快速采集当前题目');

currentQuestionHash = getCurrentQuestionHash();
initMutationObserver();
setupSpaNavigationHandler();
