const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// ==========================================
// ★★★ 強化的檔案搜尋邏輯 (修正 404 錯誤) ★★★
// ==========================================

console.log("Server running in:", __dirname);
const publicPath = path.join(__dirname, 'public');

// 1. 設定靜態資源目錄 (優先查 public，找不到查根目錄)
if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath));
}
app.use(express.static(__dirname)); // 容錯：允許直接讀取根目錄資源

// 2. 萬用檔案傳送函式
function serveFile(res, filename) {
    const fileInPublic = path.join(publicPath, filename);
    const fileInRoot = path.join(__dirname, filename);
    
    if (fs.existsSync(fileInPublic)) {
        res.sendFile(fileInPublic);
    } else if (fs.existsSync(fileInRoot)) {
        // 如果 public 裡找不到，嘗試在根目錄找
        console.log(`Serving ${filename} from root directory.`);
        res.sendFile(fileInRoot);
    } else {
        console.error(`ERROR: ${filename} not found in public or root.`);
        res.status(404).send(`Error: ${filename} not found. Please ensure the file exists.`);
    }
}

// --- 路由設定 ---

// 電腦/大螢幕首頁 -> index.html
app.get('/', (req, res) => {
    serveFile(res, 'index.html');
});

// 手機掃碼頁 -> mobile.html
app.get('/mobile.html', (req, res) => {
    serveFile(res, 'mobile.html');
});

// ==========================================
// --- 抽獎核心邏輯 ---
// ==========================================

let users = [];       
let excludedNames = []; 
let winners = [];     

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // --- A. 手機端事件 ---
    socket.on('mobile_login', (name) => {
        const cleanName = name ? name.toString().trim() : "";
        if (!cleanName) { socket.emit('login_error', 'NAME REQUIRED'); return; }
        
        // 簡單防重
        if (users.some(u => u.name === cleanName)) { 
            socket.emit('login_error', 'NAME TAKEN'); return; 
        }
        
        users.push({ id: socket.id, name: cleanName });
        socket.emit('login_success', { name: cleanName });
        io.emit('update_user_list', users.map(u => u.name));
        console.log(`[Join] ${cleanName}`);
    });

    // --- B. 大螢幕(Admin)事件 ---
    socket.on('admin_init', () => {
        socket.emit('update_user_list', users.map(u => u.name));
        socket.emit('update_winners', winners);
    });

    socket.on('admin_start_rolling', () => {
        io.emit('client_show_rolling'); 
    });

    socket.on('admin_perform_draw', () => {
        // 過濾：排除已中獎 & 被剔除
        const candidates = users.filter(u => 
            !winners.includes(u.name) && 
            !excludedNames.includes(u.name)
        );

        if (candidates.length === 0) {
            io.emit('admin_draw_error', 'NO CANDIDATES'); 
            return;
        }

        // 隨機抽出
        const winner = candidates[Math.floor(Math.random() * candidates.length)];
        winners.push(winner.name);
        
        console.log(`[Winner] ${winner.name}`);
        io.emit('draw_result', { winnerName: winner.name });
    });

    socket.on('admin_reset', () => {
        users = []; winners = []; excludedNames = [];
        io.emit('event_reset');
        io.emit('update_user_list', []);
    });
    
    socket.on('admin_toggle_exclude', (name) => {
        if (excludedNames.includes(name)) excludedNames = excludedNames.filter(n => n !== name);
        else excludedNames.push(name);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
