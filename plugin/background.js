// 后台脚本，用于处理插件的后台任务

// 创建右键菜单
chrome.runtime.onInstalled.addListener(function() {
    console.log('软考达人做题记录采集插件已安装');

    // 创建右键菜单
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
        // 发送消息给content script采集当前题目
        chrome.tabs.sendMessage(tab.id, {action: 'collectCurrentQuestion'}, function(response) {
            if (chrome.runtime.lastError) {
                console.error('发送消息失败:', chrome.runtime.lastError);
                return;
            }
            console.log('采集结果:', response);
        });
    } else if (info.menuItemId === 'collectAllWrong') {
        // 发送消息给content script采集所有可见错题
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

        // 获取当前活动标签页
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length === 0) {
                console.error('没有找到活动标签页');
                return;
            }

            const tab = tabs[0];

            // 检查是否是软考网站
            if (!tab.url || !tab.url.includes('ruankaodaren.com/exam')) {
                console.log('当前页面不是软考达人考试页面');
                return;
            }

            // 发送消息给content script采集题目
            chrome.tabs.sendMessage(tab.id, {action: 'collectCurrentQuestion'}, function(response) {
                if (chrome.runtime.lastError) {
                    console.error('发送消息失败:', chrome.runtime.lastError);
                    return;
                }
                console.log('快捷键采集结果:', response);
            });
        });
    }
});

// 监听消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'sendToBackend') {
        console.log('收到发送到后端的请求:', request.data);
        sendResponse({ success: true });
    } else if (request.action === 'getTabUrl') {
        // 返回当前标签页URL
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length > 0) {
                sendResponse({ url: tabs[0].url });
            } else {
                sendResponse({ url: null });
            }
        });
        return true; // 保持消息通道开放
    }
});