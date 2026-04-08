// 采集当前题目信息
function collectCurrentQuestion() {
    try {
        console.log('开始采集题目信息');

        const questionElement = document.getElementById('answerInfotitle');
        if (!questionElement) {
            console.error('未找到题目元素 #answerInfotitle');
            throw new Error('未找到题目元素');
        }

        let questionText = '';
        const questionParagraph = questionElement.querySelector('p');
        if (questionParagraph) {
            questionText = questionParagraph.textContent.trim();
        } else {
            const contentElements = questionElement.querySelectorAll('div, span, p');
            for (let i = 0; i < contentElements.length; i++) {
                const element = contentElements[i];
                const text = element.textContent.trim();
                if (text && text.length > 10) {
                    questionText = text;
                    break;
                }
            }
        }

        if (!questionText) {
            throw new Error('未找到题目内容');
        }

        const categoryElement = questionElement.querySelector('.secondChapterName');
        const category = categoryElement ? categoryElement.textContent.trim() : '';

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

        const answerElement = document.querySelector('.answer-to-the-question');
        let correctAnswer = '';
        let userAnswer = '';

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

        const analysisElement = document.querySelector('.right-key.paddlr.lgccquestfont1');
        const analysis = analysisElement ? analysisElement.textContent.trim() : '';

        const questionData = {
            question_id: Date.now().toString(),
            question: questionText,
            options: options,
            correct_answer: correctAnswer,
            user_answer: userAnswer,
            category: category,
            analysis: analysis
        };

        sendToBackend(questionData);
        return { success: true, data: questionData };
    } catch (error) {
        console.error('采集题目失败:', error);
        return { success: false, error: error.message };
    }
}

// 采集所有可见错题
function collectAllWrongQuestions() {
    try {
        console.log('开始采集所有可见错题');

        // 查找页面上所有可能的题目容器
        const questionContainers = document.querySelectorAll('[id*="question"], .question-item, .question-card');

        if (questionContainers.length === 0) {
            // 如果没有找到专用容器，尝试采集当前页面
            const result = collectCurrentQuestion();
            return result;
        }

        let collectedCount = 0;
        const results = [];

        questionContainers.forEach((container, index) => {
            try {
                const questionText = container.querySelector('p, .question-text, .question-content');
                const optionsContainer = container.querySelector('.options, .question-options');

                if (questionText && optionsContainer) {
                    const questionData = {
                        question_id: `batch_${Date.now()}_${index}`,
                        question: questionText.textContent.trim(),
                        options: [],
                        correct_answer: '',
                        user_answer: '',
                        category: '',
                        analysis: ''
                    };

                    const optionElements = optionsContainer.querySelectorAll('.option, .awoption');
                    optionElements.forEach(opt => {
                        questionData.options.push(opt.textContent.trim());
                    });

                    sendToBackend(questionData);
                    results.push(questionData);
                    collectedCount++;
                }
            } catch (e) {
                console.error(`采集第 ${index + 1} 个题目失败:`, e);
            }
        });

        if (collectedCount > 0) {
            showNotification(`成功采集 ${collectedCount} 道题目！`, 'success');
        } else {
            // 如果批量采集失败，尝试采集当前题目
            const result = collectCurrentQuestion();
            return result;
        }

        return { success: true, count: collectedCount };
    } catch (error) {
        console.error('采集所有错题失败:', error);
        return { success: false, error: error.message };
    }
}

// 发送数据到后端
function sendToBackend(data) {
    console.log('准备发送数据到后端:', JSON.stringify(data, null, 2));

    fetch('http://localhost:5002/api/wrong-questions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => {
        console.log('收到响应状态:', response.status);
        return response.json();
    })
    .then(result => {
        console.log('发送成功:', result);
        showNotification('采集成功！', 'success');
    })
    .catch(error => {
        console.error('发送失败:', error);
        showNotification('采集失败：' + error.message, 'error');
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
    console.log('收到消息:', request);

    if (request.action === 'collectCurrentQuestion') {
        const result = collectCurrentQuestion();
        sendResponse(result);
    } else if (request.action === 'collectAllWrongQuestions') {
        const result = collectAllWrongQuestions();
        sendResponse(result);
    }

    return true;
});

// 键盘快捷键监听（在页面上监听 Ctrl+Shift+C）
document.addEventListener('keydown', function(e) {
    // 检测 Ctrl+Shift+C (Windows/Linux) 或 Command+Shift+C (Mac)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        console.log('快捷键 Ctrl+Shift+C 被触发');
        e.preventDefault();
        const result = collectCurrentQuestion();
        if (!result.success) {
            showNotification('采集失败：' + result.error, 'error');
        }
    }
});

// 初始化
console.log('软考达人错题采集插件已加载');
console.log('提示：按 Ctrl+Shift+C 可快速采集当前题目');