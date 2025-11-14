let domain = "Enter your domain here";
let username = "Enter your email here";
let password = "Enter your password here"; 
let token; 
let botToken = '';  
let chatId = '';  
let pushplusToken = '';  
let checkInResult;
let jcType = '69yun69';  
let fetch, Response; 

// 判断当前环境是否是 Node.js 环境
if (typeof globalThis.fetch === "undefined") {
  import('node-fetch').then(module => {
    fetch = module.default;
    Response = module.Response;
    console.log("在 Node.js 环境中，已导入 node-fetch");
    const env = {
        JC_TYPE: process.env.JC_TYPE,
        DOMAIN: process.env.DOMAIN,
        USERNAME: process.env.USERNAME,
        PASSWORD: process.env.PASSWORD,
        TOKEN: process.env.TOKEN,
        TG_TOKEN: process.env.TG_TOKEN,
        TG_ID: process.env.TG_ID,
        PUSHPLUS_TOKEN: process.env.PUSHPLUS_TOKEN
    };

    const handler = {
        async scheduled(controller, env) {
            console.log("定时任务开始");
            try {
                await initConfig(env);
                await handleCheckIn();
                console.log("定时任务成功完成");
            } catch (error) {
                console.error("定时任务失败:", error);
                const errorMsg = `${jcType}定时任务失败: ${error.message}`;
                await Promise.allSettled([
                    sendMessage(errorMsg),
                    sendPushplusMessage(errorMsg)
                ]);
            }
        }
    };
      
    handler.scheduled(null, env);
      }).catch(error => {
        console.error("导入 node-fetch 失败:", error);
      });
    
} else {
  fetch = globalThis.fetch;
  Response = globalThis.Response;
  console.log("在 Cloudflare Worker 环境中，已使用内置 fetch");
}

export default {
    async fetch(request, env) {
        await initConfig(env);
        const url = new URL(request.url);

        if (url.pathname === "/tg") {
            return await handleTgMsg();
        } else if (url.pathname === `/${token}`) { 
            return await handleCheckIn();
        }

        return new Response(checkInResult, {
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            status: 200
        });
    },

    async scheduled(controller, env) {
        console.log("定时任务开始");
        try {
            await initConfig(env);
            await handleCheckIn();
            console.log("定时任务成功完成");
        } catch (error) {
            console.error("定时任务失败:", error);
            const errorMsg = `${jcType}定时任务失败: ${error.message}`;
            await Promise.allSettled([
                sendMessage(errorMsg),
                sendPushplusMessage(errorMsg)
            ]);
        }
    },
};

function decodeBase64Utf8(b64) {
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
}

async function handleCheckIn() {
    try {
        validateConfig();
        let checkInMsg = '';
        let trafficInfo = '';
        
        if (jcType === "hongxingdl") {
          checkInMsg = await hongxingdlCheckIn();
        } else {
          const cookies = await loginAndGetCookies();
          checkInMsg = await performCheckIn(cookies);
          // 新增：获取流量信息
          trafficInfo = await getTrafficInfo(cookies);
        }
 
        // 合并签到结果和流量信息
        checkInResult = `${checkInMsg}\n\n📊 流量使用情况:\n${trafficInfo}`;

        // 同时发送 Telegram 和 Pushplus 消息
        await Promise.allSettled([
            sendMessage(checkInResult),
            sendPushplusMessage(checkInResult)
        ]);
        
        return new Response(checkInResult, { status: 200 });
    } catch (error) {
        console.error("签到失败:", error);
        const errorMsg = `${checkInResult || '签到失败'}\n🎁🎁${error.message}`;
        
        await Promise.allSettled([
            sendMessage(errorMsg),
            sendPushplusMessage(errorMsg)
        ]);
        
        return new Response(errorMsg, { status: 500 });
    }
}

// 新增：获取流量信息函数
async function getTrafficInfo(cookies) {
    try {
        // 尝试从用户面板获取流量信息
        const userPanelUrl = `${domain}/user`;
        const response = await fetch(userPanelUrl, {
            method: "GET",
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
                'Cookie': cookies,
                'Referer': `${domain}/user`
            },
        });

        if (!response.ok) {
            throw new Error(`获取流量信息失败: ${response.status}`);
        }

        const html = await response.text();
        console.log("获取用户页面成功，开始解析流量信息...");
        
        // 解析HTML获取流量信息
        return parseTrafficFromHtml(html);
        
    } catch (error) {
        console.error("获取流量信息失败:", error);
        return `❌ 无法获取流量信息: ${error.message}`;
    }
}

// 新增：从HTML解析流量信息
function parseTrafficFromHtml(html) {
    try {
        console.log("开始解析HTML内容...");
        
        // 方法1：尝试匹配流量使用情况的数字模式
        const trafficPatterns = [
            // 匹配类似 "128.45 GB / 500.00 GB" 的模式
            /([\d.]+)\s*([GMK]B)\s*\/\s*([\d.]+)\s*([GMK]B)/gi,
            // 匹配已用流量和总流量分开的模式
            /已用[^：:]*[：:]\s*([\d.]+)\s*([GMK]B)/gi,
            /总流量[^：:]*[：:]\s*([\d.]+)\s*([GMK]B)/gi,
            /剩余[^：:]*[：:]\s*([\d.]+)\s*([GMK]B)/gi,
            // 匹配数字+单位模式
            /(\d+(?:\.\d+)?)\s*(GB|MB|KB|TB)/gi
        ];

        let usedTraffic = null;
        let totalTraffic = null;
        let remainingTraffic = null;

        // 尝试多种匹配模式
        for (const pattern of trafficPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
                const value = parseFloat(match[1]);
                const unit = match[2];
                
                // 根据上下文判断流量类型
                const context = html.substring(Math.max(0, match.index - 50), match.index + 50);
                
                if (context.includes('已用') || context.includes('used') || context.includes('使用')) {
                    usedTraffic = { value, unit };
                } else if (context.includes('总流量') || context.includes('total') || context.includes('全部')) {
                    totalTraffic = { value, unit };
                } else if (context.includes('剩余') || context.includes('remaining') || context.includes('剩余')) {
                    remainingTraffic = { value, unit };
                } else if (!usedTraffic) {
                    usedTraffic = { value, unit };
                } else if (!totalTraffic) {
                    totalTraffic = { value, unit };
                }
            }
        }

        // 如果找到了流量信息，构建结果
        if (usedTraffic || totalTraffic) {
            let result = '';
            
            if (usedTraffic) {
                result += `📥 已用流量: ${usedTraffic.value} ${usedTraffic.unit}\n`;
            }
            
            if (totalTraffic) {
                result += `📊 总流量: ${totalTraffic.value} ${totalTraffic.unit}\n`;
            }
            
            if (remainingTraffic) {
                result += `📤 剩余流量: ${remainingTraffic.value} ${remainingTraffic.unit}\n`;
            } else if (usedTraffic && totalTraffic) {
                // 计算剩余流量
                const usedGB = convertToGB(usedTraffic.value, usedTraffic.unit);
                const totalGB = convertToGB(totalTraffic.value, totalTraffic.unit);
                const remainingGB = totalGB - usedGB;
                
                if (remainingGB > 0) {
                    result += `📤 剩余流量: ${formatTraffic(remainingGB)}\n`;
                }
            }
            
            // 计算使用百分比
            if (usedTraffic && totalTraffic) {
                const usedGB = convertToGB(usedTraffic.value, usedTraffic.unit);
                const totalGB = convertToGB(totalTraffic.value, totalTraffic.unit);
                
                if (totalGB > 0) {
                    const percentage = ((usedGB / totalGB) * 100).toFixed(1);
                    result += `📈 使用比例: ${percentage}%`;
                    
                    // 添加使用情况提示
                    if (percentage > 90) {
                        result += ' ⚠️ 流量即将用完';
                    } else if (percentage > 70) {
                        result += ' 🔔 流量使用较多';
                    } else if (percentage < 30) {
                        result += ' ✅ 流量充足';
                    }
                }
            }
            
            return result || '⚠️ 找到流量数据但格式不匹配';
        } else {
            // 备用方案：查找包含流量关键词的区域
            const trafficSection = html.match(/<div[^>]*>(.*?(流量|Traffic).*?)<\/div>/gi);
            if (trafficSection) {
                return `🔍 检测到流量区域但无法解析，请检查页面结构`;
            }
            return '⚠️ 未找到流量信息，可能是页面结构变化';
        }
        
    } catch (error) {
        console.error("解析流量信息时出错:", error);
        return `❌ 解析流量信息失败: ${error.message}`;
    }
}

// 新增：转换流量单位为GB
function convertToGB(value, unit) {
    switch (unit.toUpperCase()) {
        case 'TB': return value * 1024;
        case 'GB': return value;
        case 'MB': return value / 1024;
        case 'KB': return value / (1024 * 1024);
        default: return value;
    }
}

// 新增：格式化流量显示
function formatTraffic(gbValue) {
    if (gbValue >= 1024) {
        return `${(gbValue / 1024).toFixed(2)} TB`;
    } else if (gbValue >= 1) {
        return `${gbValue.toFixed(2)} GB`;
    } else {
        return `${(gbValue * 1024).toFixed(2)} MB`;
    }
}

function validateConfig() {
    if (!domain || !username  || !password) {  
        throw new Error("缺少必要的配置参数");
    }
}

async function loginAndGetCookies() {
    const loginUrl = `${domain}/auth/login`;
    const response = await fetch(loginUrl, {
        method: "POST",
        headers: { 
            "Content-Type": "application/json", 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", 
            "Accept": "application/json, text/plain, */*", 
            "Origin": domain, 
            "Referer": `${domain}/auth/login`
        },
        body: JSON.stringify({ email: username , passwd: password, remember_me: "on", code: "" }),  
    });

    if (!response.ok) {
        throw new Error(`${jcType}登录失败: ${await response.text()}`);
    }

    const jsonResponse = await response.json();
    if (jsonResponse.ret !== 1) {
        throw new Error(`${jcType}登录失败: ${jsonResponse.msg || "未知错误"}`);
    }

    const cookieHeader = response.headers.get("set-cookie");
    if (!cookieHeader) {
        throw new Error("${jcType}登录成功但未收到 Cookies");
    }

    return cookieHeader.split(',').map(cookie => cookie.split(';')[0]).join("; ");
}

async function performCheckIn(cookies) {
    const checkInUrl = `${domain}/user/checkin`;
    const response = await fetch(checkInUrl, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Origin': domain,
            'Referer': `${domain}/user/panel`,
            'Cookie': cookies,
            'X-Requested-With': 'XMLHttpRequest'
        },
    });

    if (!response.ok) {
        throw new Error(`${jcType}签到请求失败: ${await response.text()}`);
    }

    const jsonResponse = await response.json();
    console.log("签到信息:", jsonResponse);
    if (jsonResponse.ret !== 1 && jsonResponse.ret !== 0) {
        throw new Error(`${jcType}签到失败: ${jsonResponse.msg || "未知错误"}`);
    }

    return `🎉🎉 ${jcType}签到结果 🎉🎉🎉\n${jsonResponse.msg || "签到完成"}`;
}

async function hongxingdlCheckIn() {
    const checkInUrl = atob("aHR0cHM6Ly9zaWduLmhvbmd4aW5nLm9uZS9zaWdu");
    const response = await fetch(checkInUrl, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ email: username , password: password }), 
    });

    if (!response.ok) {
        throw new Error(`${jcType}签到请求失败: ${await response.text()}`);
    }

    const jsonResponse = await response.json();
    console.log("签到信息:", jsonResponse);
    if (jsonResponse.status !== 200) {
        throw new Error(`${jcType}签到失败: ${jsonResponse.data?.mag ?? "未知错误"}`);
    }
 
    const bytesToMB = jsonResponse.data?.bytes ? jsonResponse.data.bytes / (1024 * 1024) : null;
    const str = bytesToMB ? (
      bytesToMB >= 1024 
      ? `，您获得了 ${(bytesToMB / 1024).toFixed(3)} GB 流量.` 
      : `，您获得了 ${bytesToMB.toFixed(3)} MB 流量.` 
    ) : '';
    return `🎉🎉 ${jcType}签到结果 🎉🎉🎉\n${jsonResponse.data?.mag ?? "签到完成"}${str}`;
}

const jcButtons = {
    "69yun69": [
        [
            {
                text: decodeBase64Utf8('44CQNjnkupHjgJHkuK3ovazpq5jpgJ/mnLrlnLos5YWo5rWB5aqS5L2T6Kej6ZSBLDEwLjg55YWDNDAwRw=='),
                url: decodeBase64Utf8('aHR0cHM6Ly82OXl1bjY5LmNvbS9hdXRoL3JlZ2lzdGVyP2NvZGU9VWNXSmto')
            }
        ]
    ],
    "hongxingdl": [
        [
            {
                text: decodeBase64Utf8('44CQOOaKmOegge+8mkFN56eR5oqA44CRW+e6ouadj+S6kV3kuK3ovazpq5jpgJ/mnLrlnLos6Kej6ZSB5YWo5rWB54Wk5L2T5ZKMR1BU'),
                url: decodeBase64Utf8('aHR0cHM6Ly9ob25neGluZ3l1bjMudmlwL3dlYi8jL2xvZ2luP2NvZGU9bW41VHVpcGY=')
            }
        ]
    ]
};

async function sendMessage(msg) {
    if (!botToken || !chatId) {
        console.log("Telegram 推送未启用. 消息内容:", msg);
        return;
    }

    const now = new Date();
    const formattedTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

    const messageText = `执行时间: ${formattedTime}\n${msg}`;

    const inline_keyboard = jcButtons[jcType] || [];
    const payload = {
        chat_id: chatId,
        text: messageText,
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard
        }
    };

    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
            console.error("Telegram 消息发送失败:", data);
            return `Telegram 消息发送失败: ${data.description || '未知错误'}`;
        }

        console.log("Telegram 消息发送成功:", data);
        return messageText;
    } catch (error) {
        console.error("发送 Telegram 消息失败:", error);
        return `发送 Telegram 消息失败: ${error.message}`;
    }
}

async function sendPushplusMessage(msg) {
    if (!pushplusToken) {
        console.log("Pushplus 推送未启用. 消息内容:", msg);
        return;
    }

    const now = new Date();
    const formattedTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

    const messageText = `执行时间: ${formattedTime}\n${msg}`;

    const payload = {
        token: pushplusToken,
        title: `${jcType}签到通知`,
        content: messageText,
        template: "txt"
    };

    try {
        const response = await fetch('https://www.pushplus.plus/send', {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || data.code !== 200) {
            console.error("Pushplus 消息发送失败:", data);
            return `Pushplus 消息发送失败: ${data.msg || '未知错误'}`;
        }

        console.log("Pushplus 消息发送成功:", data);
        return messageText;
    } catch (error) {
        console.error("发送 Pushplus 消息失败:", error);
        return `发送 Pushplus 消息失败: ${error.message}`;
    }
}

function formatDomain(domain) {
    return domain.includes("//") ? domain : `https://${domain}`;
}

async function handleTgMsg() {
    const message = `${checkInResult}`;
    const sendResult = await sendMessage(message);
    return new Response(sendResult, { status: 200 });
}

function maskSensitiveData(str, type = 'default') {
    if (!str) return "N/A";

   const urlPattern = /^(https?:\/\/)([^\/]+)(.*)$/;
    if (type === 'url' && urlPattern.test(str)) {
        return str.replace(/(https:\/\/)(\w)(\w+)(\w)(\.\w+)/, '$1$2****$4$5');;
    }

    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (type === 'email' && emailPattern.test(str)) {
        return str.replace(/^(\w)(\w+)(\@)(\w)(\w+)(\.\w+)$/, '$1****$3$4****$6');
    }

    return `${str[0]}****${str[str.length - 1]}`;
}

async function initConfig(env) {
    domain = formatDomain(env.DOMAIN || domain);
    username  = env.USERNAME || username ;
    password = env.PASSWORD || password;  
    token = env.TOKEN || token;  
    botToken = env.TG_TOKEN || botToken;  
    chatId = env.TG_ID || chatId; 
    jcType = env.JC_TYPE || jcType; 
    pushplusToken = env.PUSHPLUS_TOKEN || pushplusToken;
    
    checkInResult = `配置信息: 
    机场类型: ${jcType} 
    登录地址: ${maskSensitiveData(domain, 'url')} 
    登录账号: ${maskSensitiveData(username, 'email')} 
    登录密码: ${maskSensitiveData(password)} 
    TG 推送:  ${botToken && chatId ? "已启用" : "未启用"} 
    Pushplus 推送: ${pushplusToken ? "已启用" : "未启用"}`;
}
