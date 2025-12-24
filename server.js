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

// --- 檔案路徑設定 ---
console.log("Server started in:", __dirname);
const publicPath = path.join(__dirname, 'public');

if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath));
} else {
    app.use(express.static(__dirname));
}

function serveFile(res, filename) {
    const fileInPublic = path.join(publicPath, filename);
    const fileInRoot = path.join(__dirname, filename);
    
    if (fs.existsSync(fileInPublic)) {
        res.sendFile(fileInPublic);
    } else if (fs.existsSync(fileInRoot)) {
        res.sendFile(fileInRoot);
    } else {
        res.status(404).send(`Error: ${filename} not found.`);
    }
}

app.get('/', (req, res) => serveFile(res, 'index.html'));
app.get('/mobile.html', (req, res) => serveFile(res, 'mobile.html'));

// ==========================================
// --- 抽獎邏輯 (支援斷線重連) ---
// ==========================================

let users = [];       // { id: socket.id, name: "Name", uid: "unique-id" }
let excludedNames = []; 
let winners = [];     

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // --- A. 手機端事件 (更新版) ---
    socket.on('mobile_login', (data) => {
        // 相容舊版寫法 (如果 data 是字串) 與新版物件
        const name = (typeof data === 'object') ? data.name : data;
        const uid = (typeof data === 'object') ? data.uid : null;

        const cleanName = name ? name.toString().trim() : "";
        if (!cleanName) { socket.emit('login_error', 'NAME REQUIRED'); return; }
        
        // 檢查名字是否已存在
        const existingUser = users.find(u => u.name === cleanName);

        if (existingUser) {
            // ★★★ 重連邏輯 ★★★
            // 如果名字存在，且 UID 吻合，視為本人重連
            if (uid && existingUser.uid === uid) {
                existingUser.id = socket.id; // 更新連線 ID
                socket.emit('login_success', { name: cleanName, isReconnect: true });
                console.log(`[Reconnect] ${cleanName}`);
                // 不需要廣播 update_user_list，因為名單沒變
            } else {
                // 名字存在但 UID 不同 (或是舊版沒有 UID)，視為名稱衝突
                socket.emit('login_error', 'NAME TAKEN');
            }
        } else {
            // 新使用者
            users.push({ id: socket.id, name: cleanName, uid: uid });
            socket.emit('login_success', { name: cleanName, isReconnect: false });
            io.emit('update_user_list', users.map(u => u.name));
            console.log(`[Join] ${cleanName}`);
        }
    });

    // --- B. 大螢幕(Admin)事件 ---
    socket.on('admin_init', () => {
        socket.emit('update_user_list', users.map(u => u.name));
        socket.emit('update_winners', winners);
    });

    socket.on('admin_start_rolling', () => io.emit('client_show_rolling'));

    socket.on('admin_perform_draw', () => {
        const candidates = users.filter(u => 
            !winners.includes(u.name) && 
            !excludedNames.includes(u.name)
        );

        if (candidates.length === 0) {
            io.emit('admin_draw_error', 'NO CANDIDATES'); 
            return;
        }

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
