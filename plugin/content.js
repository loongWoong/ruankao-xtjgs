// 采集当前题目信息
function collectCurrentQuestion() {
    try {
        console.log('开始采集题目信息');

        const questionElement = document.getElementById('answerInfotitle');
        if (!questionElement) {
            console.error('未找到题目元素 #answerInfotitle');
            throw new Error('未找到题目元素');
        }

        // 题目内容在第一个div的文本中（排除第二个div的分类信息）
        let questionText = '';

        // 获取所有子元素
        const children = questionElement.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            // 找到第一个包含题目内容的div，跳过分类div
            if (!child.className.includes('secondChapterName')) {
                const text = child.textContent.trim();
                if (text && text.length > 10) {
                    questionText = text;
                    break;
                }
            }
        }

        // 如果没找到，尝试直接获取div的文本内容
        if (!questionText) {
            const text = questionElement.firstElementChild.textContent.trim();
            if (text && text.length > 10) {
                questionText = text;
            }
        }

        // 清理题目文本中的空白字符
        if (questionText) {
            questionText = questionText.replace(/\s+/g, ' ').trim();
        }

        console.log('提取的题目:', questionText);

        if (!questionText) {
            throw new Error('未找到题目内容');
        }

        // 获取分类信息
        const categoryElement = questionElement.querySelector('.secondChapterName');
        const category = categoryElement ? categoryElement.textContent.trim() : '';
        console.log('分类:', category);

        // 获取选项
        const optionsElement = document.querySelector('.questionaw');
        if (!optionsElement) {
            throw new Error('未找到选项元素');
        }

        const options = [];
        const optionElements = optionsElement.querySelectorAll('.options, .aWFalse, .aWtrue');

        optionElements.forEach((optionElement) => {
            const optionLabelElement = optionElement.querySelector('.awoption');
            const contentElement = optionElement.querySelector('.content .ql-editor');
            if (optionLabelElement && contentElement) {
                const optionLabel = optionLabelElement.textContent.trim();
                const optionContent = contentElement.textContent.trim();
                options.push(`${optionLabel} ${optionContent}`);
            }
        });
        console.log('找到选项数量:', options.length);

        // 获取答案信息
        let correctAnswer = '';
        let userAnswer = '';

        const answerElement = document.querySelector('.answer-to-the-question');
        if (answerElement) {
            const rightKeyElements = answerElement.querySelectorAll('.right-key');
            rightKeyElements.forEach(el => {
                const text = el.textContent.trim();
                if (text.startsWith('正确答案：')) {
                    correctAnswer = text.replace('正确答案：', '').trim();
                } else if (text.startsWith('你的答案：')) {
                    userAnswer = text.replace('你的答案：', '').trim();
                }
            });
        }
        console.log('正确答案:', correctAnswer, '用户答案:', userAnswer);

        // 获取解析
        const analysisElement = document.querySelector('.right-key.paddlr.lgccquestfont1');
        const analysis = analysisElement ? analysisElement.textContent.trim() : '';
        console.log('解析:', analysis);

        const questionData = {
            question_id: Date.now().toString(),
            question: questionText,
            options: options,
            correct_answer: correctAnswer,
            user_answer: userAnswer,
            category: category,
            analysis: analysis
        };

        console.log('采集的数据:', JSON.stringify(questionData, null, 2));

        return { success: true, data: questionData, pendingSend: true };
    } catch (error) {
        console.error('采集题目失败:', error);
        return { success: false, error: error.message };
    }
}

// 采集单个题目元素的数据
function collectQuestionElement(questionEl) {
    try {
        const questionTitleEl = questionEl.querySelector('#answerInfotitle, .answerInfotitle, [id*="answerInfotitle"]');
        if (!questionTitleEl) {
            return null;
        }

        let questionText = '';
        const children = questionTitleEl.children;
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

        if (!questionText && questionTitleEl.firstElementChild) {
            const text = questionTitleEl.firstElementChild.textContent.trim();
            if (text && text.length > 10) {
                questionText = text;
            }
        }

        if (questionText) {
            questionText = questionText.replace(/\s+/g, ' ').trim();
        }

        if (!questionText) {
            return null;
        }

        const categoryElement = questionTitleEl.querySelector('.secondChapterName');
        const category = categoryElement ? categoryElement.textContent.trim() : '';

        const optionsElement = questionEl.querySelector('.questionaw');
        const options = [];
        if (optionsElement) {
            const optionElements = optionsElement.querySelectorAll('.options, .aWFalse, .aWtrue');
            optionElements.forEach((optionElement) => {
                const optionLabelElement = optionElement.querySelector('.awoption');
                const contentElement = optionElement.querySelector('.content .ql-editor');
                if (optionLabelElement && contentElement) {
                    const optionLabel = optionLabelElement.textContent.trim();
                    const optionContent = contentElement.textContent.trim();
                    options.push(`${optionLabel} ${optionContent}`);
                }
            });
        }

        let correctAnswer = '';
        let userAnswer = '';
        const answerElement = questionEl.querySelector('.answer-to-the-question');
        if (answerElement) {
            const rightKeyElements = answerElement.querySelectorAll('.right-key');
            rightKeyElements.forEach(el => {
                const text = el.textContent.trim();
                if (text.startsWith('正确答案：')) {
                    correctAnswer = text.replace('正确答案：', '').trim();
                } else if (text.startsWith('你的答案：')) {
                    userAnswer = text.replace('你的答案：', '').trim();
                }
            });
        }

        const analysisElement = questionEl.querySelector('.right-key.paddlr.lgccquestfont1');
        const analysis = analysisElement ? analysisElement.textContent.trim() : '';

        return {
            question_id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
            question: questionText,
            options: options,
            correct_answer: correctAnswer,
            user_answer: userAnswer,
            category: category,
            analysis: analysis
        };
    } catch (error) {
        console.error('采集单道题目失败:', error);
        return null;
    }
}

// 采集所有可见错题
async function collectAllWrongQuestions() {
    try {
        console.log('开始采集所有可见错题');

        let questionElements = [];

        const titleElements = document.querySelectorAll('#answerInfotitle, [id*="answerInfotitle"], .answerInfotitle');
        if (titleElements.length > 0) {
            for (const titleEl of titleElements) {
                let container = titleEl.closest('[class*="question"], [class*="Question"], [class*="item"], [class*="card"], [class*="exercise"]');
                if (!container) {
                    container = titleEl.parentElement;
                    while (container && container.parentElement && container.children.length < 3) {
                        container = container.parentElement;
                    }
                }
                if (container && !questionElements.includes(container)) {
                    questionElements.push(container);
                }
            }
        }

        if (questionElements.length <= 1) {
            const selectors = [
                '.question-item',
                '.exercise-item',
                '.wrong-question-item',
                '.question-card',
                '.exam-question',
                '[class*="question-item"]',
                '[class*="QuestionItem"]',
                '[class*="wrong-question"]'
            ];
            for (const selector of selectors) {
                const els = document.querySelectorAll(selector);
                if (els.length > 1) {
                    questionElements = Array.from(els);
                    break;
                }
            }
        }

        if (questionElements.length === 0) {
            const singleQuestion = document.getElementById('answerInfotitle');
            if (singleQuestion) {
                const result = collectCurrentQuestion();
                return result;
            }
            throw new Error('未找到任何题目元素，请确保在错题列表或答题页面');
        }

        console.log(`找到 ${questionElements.length} 道题目`);

        const collectedQuestions = [];
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < questionElements.length; i++) {
            const questionEl = questionElements[i];
            const questionData = collectQuestionElement(questionEl);

            if (questionData) {
                collectedQuestions.push(questionData);
                try {
                    await sendToBackendViaBackgroundAsync(questionData);
                    successCount++;
                } catch (e) {
                    failCount++;
                    console.error(`第 ${i + 1} 题发送失败:`, e);
                }
            } else {
                failCount++;
            }

            showNotification(`采集中... ${i + 1}/${questionElements.length}`, 'info');
        }

        const resultMsg = `采集完成：成功 ${successCount} 道，失败 ${failCount} 道`;
        console.log(resultMsg);
        showNotification(resultMsg, successCount > 0 ? 'success' : 'error');

        return {
            success: successCount > 0,
            total: questionElements.length,
            successCount: successCount,
            failCount: failCount,
            data: collectedQuestions
        };
    } catch (error) {
        console.error('采集所有错题失败:', error);
        return { success: false, error: error.message };
    }
}

// 异步版本的发送函数
function sendToBackendViaBackgroundAsync(data) {
    return new Promise((resolve, reject) => {
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
    });
}

// 通过background script发送数据到后端
function sendToBackendViaBackground(data) {
    console.log('通过background script发送数据');

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
        showNotification('采集成功！', 'success');
    });
}

// 显示通知
function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        background: ${type === 'success' ? '#4CAF50' : '#f44336'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        font-family: Arial, sans-serif;
        font-size: 14px;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// 监听来自popup和background的消息
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

// 键盘快捷键监听
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

// 初始化
console.log('软考达人错题采集插件已加载');
console.log('提示：按 Ctrl+Shift+C 可快速采集当前题目');