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
// ★★★ 伺服器啟動與靜態檔案設定 ★★★
// ==========================================

// Debug: 顯示目前目錄下的檔案，方便除錯
console.log("Current Directory:", __dirname);
const publicPath = path.join(__dirname, 'public');

if (fs.existsSync(publicPath)) {
    console.log("Public folder found. Serving static files.");
} else {
    console.error("CRITICAL ERROR: 'public' folder NOT found. Please check deployment structure.");
}

// 1. 設定靜態檔案資料夾 (讓前端能讀取 JSON, CSS, JS)
app.use(express.static(publicPath));

// 2. 輔助函式：安全傳送檔案
function serveFile(res, filename) {
    const fileInPublic = path.join(publicPath, filename);
    
    if (fs.existsSync(fileInPublic)) {
        res.sendFile(fileInPublic);
    } else {
        console.error(`File missing: ${fileInPublic}`);
        res.status(404).send(`Error: ${filename} not found. Please ensure it exists in the 'public' folder.`);
    }
}

// ==========================================
// ★★★ 路由設定 ★★★
// ==========================================

// 1. 根目錄 '/' -> 進入大螢幕 (index.html)
app.get('/', (req, res) => {
    serveFile(res, 'index.html');
});

// 2. 手機端路由 '/mobile.html'
app.get('/mobile.html', (req, res) => {
    serveFile(res, 'mobile.html');
});

// ==========================================
// ★★★ Socket.io 邏輯 (抽獎核心) ★★★
// ==========================================

let users = [];       // 參加者名單 { id, name }
let excludedNames = []; // 被剔除的名字
let winners = [];     // 已中獎的名字

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // --- 手機端事件 ---

    socket.on('mobile_login', (name) => {
        const cleanName = name ? name.toString().trim() : "";
        
        if (!cleanName) {
            socket.emit('login_error', '名字不能為空');
            return;
        }

        // 檢查重複
        const isDuplicate = users.some(u => u.name === cleanName);
        if (isDuplicate) {
            socket.emit('login_error', '此名字已被使用，請換一個');
            return;
        }

        // 加入名單
        users.push({ id: socket.id, name: cleanName });
        
        // 回傳成功 & 廣播更新
        socket.emit('login_success', { name: cleanName });
        io.emit('update_user_list', users.map(u => u.name));
        
        console.log(`[Join] ${cleanName} (${socket.id})`);
    });

    // --- 大螢幕(Admin)事件 ---

    // 初始化資料
    socket.on('admin_init', () => {
        socket.emit('update_user_list', users.map(u => u.name));
        socket.emit('update_winners', winners);
    });

    // 開始滾動 (同步手機顯示動畫)
    socket.on('admin_start_rolling', () => {
        io.emit('client_show_rolling'); 
    });

    // 執行抽獎 (過濾名單 -> 隨機抽出 -> 廣播)
    socket.on('admin_perform_draw', () => {
        // 過濾條件：不在中獎名單內 且 不在剔除名單內
        const candidates = users.filter(u => 
            !winners.includes(u.name) && 
            !excludedNames.includes(u.name)
        );

        console.log(`[Draw] Pool Size: ${candidates.length}`);

        if (candidates.length === 0) {
            io.emit('admin_draw_error', '無有效參加者或名單已抽完');
            return;
        }

        // 隨機選出一位
        const randomIndex = Math.floor(Math.random() * candidates.length);
        const winner = candidates[randomIndex];
        
        // 加入中獎名單
        winners.push(winner.name);

        console.log(`[Winner] ${winner.name}`);
        
        // 廣播結果 (含中獎者名字)
        io.emit('draw_result', { winnerName: winner.name });
    });

    // 重置活動
    socket.on('admin_reset', () => {
        users = [];
        winners = [];
        excludedNames = [];
        io.emit('event_reset'); // 通知所有人重整頁面
        io.emit('update_user_list', []);
        console.log('[Reset] Event reset');
    });
    
    // 剔除/恢復名單
    socket.on('admin_toggle_exclude', (name) => {
        if (excludedNames.includes(name)) {
            excludedNames = excludedNames.filter(n => n !== name);
        } else {
            excludedNames.push(name);
        }
    });

    socket.on('disconnect', () => {
        // 可選：斷線處理邏輯
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
