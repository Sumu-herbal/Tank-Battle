/**
 * 坦克大战 - 网络层 (WebSocket 客户端)
 * 自动连接 + 断线重连 + sessionStorage 持久化 + 状态快照恢复
 */
class Network {
    constructor() {
        this.ws = null;
        this._handler = null;
        this._msgBuffer = [];
        this._reconnectTimer = null;
        this._intentionalClose = false;
        this.playerId = null;
        this.sessionToken = null;
        this.state = 'connecting'; // connecting | connected | reconnecting | disconnected

        // 从 sessionStorage 恢复会话（支持页面刷新）
        this._loadSession();
        this.connect();
    }

    // ===== sessionStorage 持久化 =====
    _loadSession() {
        try {
            const saved = sessionStorage.getItem('tank_session');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.playerId && data.sessionToken) {
                    this.playerId = data.playerId;
                    this.sessionToken = data.sessionToken;
                    console.log('📋 恢复会话:', data.playerId);
                }
            }
        } catch(e) { /* 忽略 */ }
    }

    _saveSession(playerId, sessionToken) {
        try {
            sessionStorage.setItem('tank_session', JSON.stringify({
                playerId, sessionToken, savedAt: Date.now()
            }));
            this.playerId = playerId;
            this.sessionToken = sessionToken;
        } catch(e) { /* quota exceeded, ignore */ }
    }

    _clearSession() {
        try { sessionStorage.removeItem('tank_session'); } catch(e) {}
        this.playerId = null;
        this.sessionToken = null;
    }

    // ===== 连接管理 =====
    connect() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname || '134.175.119.193';
        const wsUrl = `${protocol}//${host}:3000`;

        this._setState('connecting');
        console.log(`🔗 连接: ${wsUrl}`);
        try {
            this.ws = new WebSocket(wsUrl);
        } catch(e) {
            console.error('WebSocket 创建失败:', e);
            this._scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            console.log('✅ WebSocket 已连接');
            // 如果有保存的会话，发送重连请求
            if (this.playerId && this.sessionToken) {
                console.log('🔄 发送重连请求:', this.playerId);
                this._setState('reconnecting');
                this.send({ type: 'reconnect', playerId: this.playerId, sessionToken: this.sessionToken });
            } else {
                // 新玩家：发送 join 让服务器立即创建玩家（带上名字如果有的话）
                console.log('🆕 新玩家加入');
                const nameInput = document.getElementById('playerName');
                const name = nameInput ? nameInput.value.trim().substring(0, 8) : '';
                this.send({ type: 'join', name: name || undefined });
            }
            // 处理缓冲消息
            this._flushBuffer();
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (this._handler) {
                    this._handler(msg);
                } else {
                    this._msgBuffer.push(msg);
                }
            } catch(e) {
                console.warn('消息解析失败:', e);
            }
        };

        this.ws.onclose = (event) => {
            console.warn('❌ WebSocket 关闭, code:', event.code);
            this.ws = null;
            if (!this._intentionalClose) {
                this._setState('disconnected');
                this._scheduleReconnect();
            } else {
                this._setState('disconnected');
            }
        };

        this.ws.onerror = (err) => {
            console.error('WebSocket 错误:', err);
        };
    }

    // ===== 消息处理器 =====
    setHandler(fn) {
        this._handler = fn;
        this._flushBuffer();
    }

    _flushBuffer() {
        if (!this._handler || this._msgBuffer.length === 0) return;
        console.log(`📦 处理缓冲消息 x${this._msgBuffer.length}`);
        const msgs = this._msgBuffer.splice(0);
        for (const msg of msgs) {
            try { this._handler(msg); } catch(e) {}
        }
    }

    // ===== 重连调度（指数退避） =====
    _scheduleReconnect() {
        if (this._reconnectTimer) return;
        if (!this.playerId) {
            // 没有会话 → 首次连接失败，退避但不清除
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this.connect();
            }, 3000);
            return;
        }
        // 有会话 → 阶梯退避
        const attempts = this._reconnectAttempts = (this._reconnectAttempts || 0) + 1;
        const delays = [500, 1000, 2000, 4000, 8000, 15000];
        const delay = delays[Math.min(attempts - 1, delays.length - 1)];
        console.log(`⏳ ${delay/1000}s 后重连 (第${attempts}次)...`);
        this._setState('reconnecting');
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this.connect();
        }, delay);
    }

    // 重连成功时重置退避计数
    _resetBackoff() {
        this._reconnectAttempts = 0;
    }

    _setState(state) {
        this.state = state;
        // 触发 UI 更新
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('netstate', { detail: state }));
        }
    }

    // ===== 发送 =====
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(data));
            } catch(e) {}
        }
    }

    close() {
        this._intentionalClose = true;
        this._clearSession();
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this.ws) {
            try { this.ws.close(); } catch(e) {}
            this.ws = null;
        }
        this._setState('disconnected');
    }
}

// 全局实例
window.network = new Network();
