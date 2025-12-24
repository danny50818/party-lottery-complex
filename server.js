const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// ==========================================
// ★★★ 路由設定 ★★★
// ==========================================

// 輔助函式：安全地回傳檔案
function serveFile(res, filename) {
    const fileInPublic = path.join(__dirname, 'public', filename);
    const fileInRoot = path.join(__dirname, filename);
    
    if (fs.existsSync(fileInPublic)) {
        res.sendFile(fileInPublic);
    } else if (fs.existsSync(fileInRoot)) {
        res.sendFile(fileInRoot);
    } else {
        res.status(404).send(`Error: ${filename} not found.`);
    }
}

// 1. 首頁 (根目錄) -> 大螢幕 (index.html)
app.get('/', (req, res) => {
    serveFile(res, 'index.html');
});

// 2. 手機頁 -> mobile.html
app.get('/mobile.html', (req, res) => {
    serveFile(res, 'mobile.html');
});

// 3. 靜態檔案服務 (CSS, JS, Lottie JSON 等)
// 確保 public 資料夾存在
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath));
} else {
    // 如果 public 不存在，嘗試使用根目錄 (容錯)
    app.use(express.static(__dirname));
}

// ==========================================

// --- 資料狀態 ---
let users = [];       // 所有參加者 { id, name }
let excludedNames = []; // 被剔除的名單 (字串陣列)
let winners = [];     // 已中獎名單 (字串陣列)

// --- Socket.io 事件處理 ---
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // --- A. 手機端事件 ---

    // 手機登入請求
    socket.on('mobile_login', (name) => {
        const cleanName = name ? name.toString().trim() : "";
        
        if (!cleanName) {
            socket.emit('login_error', '名字不能為空');
            return;
        }

        // 檢查名字是否重複 (簡單防重)
        const isDuplicate = users.some(u => u.name === cleanName);
        if (isDuplicate) {
            socket.emit('login_error', '此名字已被使用，請換一個');
            return;
        }

        // 加入使用者
        const newUser = { id: socket.id, name: cleanName };
        users.push(newUser);

        // 回傳成功
        socket.emit('login_success', { name: cleanName });
        
        // 廣播給大螢幕更新列表
        io.emit('update_user_list', users.map(u => u.name));
        
        console.log(`[Join] ${cleanName} (${socket.id})`);
    });

    // --- B. 大螢幕(Admin)事件 ---

    // 初始化
    socket.on('admin_init', () => {
        socket.emit('update_user_list', users.map(u => u.name));
        socket.emit('update_winners', winners);
    });

    // 開始滾動 (同步手機顯示動畫)
    socket.on('admin_start_rolling', () => {
        io.emit('client_show_rolling'); 
    });

    // 執行抽獎
    socket.on('admin_perform_draw', () => {
        // 1. 篩選候選人：排除已中獎 & 被剔除
        const candidates = users.filter(u => 
            !winners.includes(u.name) && 
            !excludedNames.includes(u.name)
        );

        console.log(`[Draw] Pool: ${candidates.length}, Winners: ${winners.length}, Excluded: ${excludedNames.length}`);

        if (candidates.length === 0) {
            io.emit('admin_draw_error', '無有效參加者或名單已抽完');
            return;
        }

        // 2. 隨機抽選
        const randomIndex = Math.floor(Math.random() * candidates.length);
        const winner = candidates[randomIndex];
        
        // 3. 加入中獎名單
        winners.push(winner.name);

        console.log(`[Winner] ${winner.name}`);
        
        // 4. 廣播結果
        io.emit('draw_result', { winnerName: winner.name });
    });

    // 重置活動
    socket.on('admin_reset', () => {
        users = [];
        winners = [];
        excludedNames = [];
        io.emit('event_reset'); // 通知所有人重置
        io.emit('update_user_list', []);
        console.log('[Reset] Event reset');
    });
    
    // 剔除管理
    socket.on('admin_toggle_exclude', (name) => {
        if (excludedNames.includes(name)) {
            excludedNames = excludedNames.filter(n => n !== name);
        } else {
            excludedNames.push(name);
        }
        // 不需要特別回傳，大螢幕本地會維護剔除狀態，下次抽獎時 Server 會使用這個 excludedNames
    });

    socket.on('disconnect', () => {
        // console.log(`Socket disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
