// 后台脚本，用于处理插件的后台任务

const API_URL = 'http://localhost:5002/api/wrong-questions';

// 创建右键菜单
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

    console.log('右键菜单已创建');
});

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(function(info, tab) {
    if (info.menuItemId === 'collectQuestion') {
        chrome.tabs.sendMessage(tab.id, {action: 'collectCurrentQuestion'}, function(response) {
            if (chrome.runtime.lastError) {
                console.error('发送消息失败:', chrome.runtime.lastError);
                return;
            }
            console.log('采集结果:', response);
            if (response && response.success && response.data) {
                fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(response.data)
                }).catch(e => console.error('右键菜单发送失败:', e));
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

// 处理快捷键命令
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

            chrome.tabs.sendMessage(tab.id, {action: 'collectCurrentQuestion'}, function(response) {
                if (chrome.runtime.lastError) {
                    console.error('发送消息失败:', chrome.runtime.lastError);
                    return;
                }
                console.log('快捷键采集结果:', response);
                if (response && response.success && response.data) {
                    fetch(API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(response.data)
                    }).catch(e => console.error('快捷键发送失败:', e));
                }
            });
        });
    }
});

// 处理来自content script的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'sendToBackend') {
        console.log('收到发送到后端的请求:', request.data);

        fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(request.data)
        })
        .then(response => {
            console.log('后端响应状态:', response.status);
            return response.json();
        })
        .then(result => {
            console.log('发送到后端成功:', result);
            sendResponse({ success: true, data: result });
        })
        .catch(error => {
            console.error('发送到后端失败:', error);
            sendResponse({ success: false, error: error.message });
        });

        return true; // 保持消息通道开放
    } else if (request.action === 'getTabUrl') {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length > 0) {
                sendResponse({ url: tabs[0].url });
            } else {
                sendResponse({ url: null });
            }
        });
        return true;
    }
});

console.log('Background script loaded');